import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { useMemo, useState } from 'react';
import { useCategoriesPageQuery } from '../features/categories/page-queries';
import { CategoryIcon } from '../features/categories/CategoryIcon';
import { CategoryBreakdown } from '../features/categories/CategoryBreakdown';
import { TagGroupsPanel } from '../features/categories/TagGroupsPanel';
import {
  useCreateCategoryMutation,
  useCreateTagMutation,
  useDeleteCategoryMutation,
  useDeleteTagMutation,
  useRestoreCategoryMutation,
  useUpdateCategoryMutation,
  useUpdateTagMutation,
} from '../features/categories/queries';
import { cn } from '../lib/utils';
import { PRESET_COLORS } from '../lib/constants';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { toast, errorMessage } from '../components/ui/useToast';
import { MoreHorizontal, Plus } from 'lucide-react';

export const Route = createFileRoute('/categories')({
  component: CategoriesPage,
});

interface Category {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  reportingAccountId: number | null;
  isActive: boolean;
}

type ExpenseAccount = {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
};

interface TagRow {
  id: number;
  name: string;
  color: string;
  groupId?: number | null;
}

function CategoriesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const categoriesQuery = useCategoriesPageQuery(true);
  const createCategoryMutation = useCreateCategoryMutation();
  const updateCategoryMutation = useUpdateCategoryMutation();
  const deleteCategoryMutation = useDeleteCategoryMutation();
  const restoreCategoryMutation = useRestoreCategoryMutation();
  const createTagMutation = useCreateTagMutation();
  const updateTagMutation = useUpdateTagMutation();
  const deleteTagMutation = useDeleteTagMutation();
  const allCategories = useMemo(
    () => (categoriesQuery.data?.categories ?? []) as Category[],
    [categoriesQuery.data?.categories],
  );
  const categories = showArchived ? allCategories : allCategories.filter((category) => category.isActive);
  const tags = (categoriesQuery.data?.tags ?? []) as TagRow[];
  const tagGroups = categoriesQuery.data?.tagGroups ?? [];
  const expenseAccounts = (categoriesQuery.data?.expenseAccounts ?? []) as ExpenseAccount[];
  const isLoading = categoriesQuery.isPending && !categoriesQuery.data;
  const { confirm } = useConfirm();

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingTag, setEditingTag] = useState<TagRow | null>(null);

  const [categoryForm, setCategoryForm] = useState<{ name: string; icon: string; color: string; reportingAccountId: string }>({ name: '', icon: '📌', color: PRESET_COLORS[0], reportingAccountId: '' });
  const [tagForm, setTagForm] = useState<{ name: string; color: string; groupId: string }>({ name: '', color: PRESET_COLORS[0], groupId: '' });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [menuCategoryId, setMenuCategoryId] = useState<number | null>(null);

  const usedCategoryColors = useMemo(() => new Set(
    allCategories
      .filter((category) => category.id !== editingCategory?.id)
      .map((category) => category.color?.toUpperCase())
      .filter((color): color is string => Boolean(color)),
  ), [allCategories, editingCategory?.id]);
  const firstAvailableCategoryColor = PRESET_COLORS.find((color) => !usedCategoryColors.has(color)) ?? PRESET_COLORS[0];

  // Counted on the server across every posted entry, so the numbers don't depend on what's loaded.
  const usageData = categoriesQuery.data?.usage;
  const stats = {
    byCat: usageData?.byCategory ?? {},
    byTag: usageData?.byTag ?? {},
    categorizedPct: usageData?.expenseCount ? Math.round((usageData.categorizedExpenseCount / usageData.expenseCount) * 100) : 0,
    taggedPct: usageData?.transactionCount ? Math.round((usageData.taggedCount / usageData.transactionCount) * 100) : 0,
  };

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSubmitting(true);
    try {
      if (editingCategory) {
        await updateCategoryMutation.mutateAsync({ id: editingCategory.id, data: {
          name: categoryForm.name,
          icon: categoryForm.icon || null,
          color: categoryForm.color || null,
          reportingAccountId: categoryForm.reportingAccountId ? Number(categoryForm.reportingAccountId) : null,
        } });
      } else {
        await createCategoryMutation.mutateAsync({
          name: categoryForm.name,
          icon: categoryForm.icon || null,
          color: categoryForm.color || null,
          reportingAccountId: categoryForm.reportingAccountId ? Number(categoryForm.reportingAccountId) : null,
        });
      }
      closeCategoryModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSubmitting(true);
    try {
      const groupId = tagForm.groupId ? Number(tagForm.groupId) : null;
      if (editingTag) {
        await updateTagMutation.mutateAsync({ id: editingTag.id, data: { name: tagForm.name, color: tagForm.color, groupId } });
      } else {
        const created = await createTagMutation.mutateAsync({ name: tagForm.name, color: tagForm.color });
        if (groupId != null) await updateTagMutation.mutateAsync({ id: created.id, data: { groupId } });
      }
      closeTagModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCategory = async (id: number) => {
    const confirmed = await confirm({
      title: 'Archive category',
      message: 'Archive this category? Historical transactions and budgets will remain available, but new entries will no longer offer it.',
      confirmLabel: 'Archive',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteCategoryMutation.mutateAsync(id);
      toast.show({ type: 'success', title: 'Category archived', duration: 8000, action: { label: 'Undo', onClick: () => void handleRestoreCategory(id) } });
    } catch (err) {
      toast.error('Could not archive category', errorMessage(err));
    }
  };

  const handleRestoreCategory = async (id: number) => {
    try {
      await restoreCategoryMutation.mutateAsync(id);
    } catch (err) {
      toast.error('Could not restore category', errorMessage(err));
    }
  };

  const openCategoryModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setCategoryForm({
        name: category.name,
        icon: category.icon || '📌',
        color: category.color || PRESET_COLORS[0],
        reportingAccountId: category.reportingAccountId?.toString() || '',
      });
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '', icon: '📌', color: firstAvailableCategoryColor, reportingAccountId: '' });
    }
    setFormError('');
    setIsCategoryModalOpen(true);
  };

  const openTagModal = (tag?: TagRow) => {
    if (tag) {
      setEditingTag(tag);
      setTagForm({ name: tag.name, color: tag.color, groupId: tag.groupId ? String(tag.groupId) : '' });
    } else {
      setEditingTag(null);
      setTagForm({ name: '', color: PRESET_COLORS[0], groupId: '' });
    }
    setFormError('');
    setIsTagModalOpen(true);
  };

  const closeCategoryModal = () => {
    setIsCategoryModalOpen(false);
    setEditingCategory(null);
    setFormError('');
  };

  const closeTagModal = () => {
    setIsTagModalOpen(false);
    setEditingTag(null);
    setFormError('');
  };

  const usage = (category: Category) => stats.byCat[category.id] ?? 0;
  // Most-used first, archived ones at the end.
  const orderedCategories = [...categories].sort((a, b) => Number(b.isActive) - Number(a.isActive) || usage(b) - usage(a) || a.name.localeCompare(b.name));
  const archivedCount = allCategories.filter((category) => !category.isActive).length;
  // The category list's row menus pop out of the panel, so it doesn't clip its content.
  const panelFrame = 'rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]';
  const panelHeader = 'flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5';

  return (
    <RequireAuth>
      <PageContainer>
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <PageHeader
            subtext="Category management"
            title="Ledger classification"
            description="How spending is grouped in reports and budgets, and the tags you add on top."
          />
          <Button onClick={() => openCategoryModal()} className="self-start md:self-auto">
            <Plus className="mr-2 h-4 w-4" />
            New category
          </Button>
        </header>

        <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-4">
          {[
            { label: 'Categories', value: String(allCategories.filter((category) => category.isActive).length), meter: null },
            { label: 'Tags', value: String(tags.length), meter: null },
            { label: 'Spending categorized', value: `${stats.categorizedPct}%`, meter: stats.categorizedPct },
            { label: 'Entries tagged', value: `${stats.taggedPct}%`, meter: stats.taggedPct },
          ].map((item) => (
            <div key={item.label} className="bg-[var(--ref-surface-container-lowest)] px-5 py-4">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-[var(--ref-on-surface-variant)]">{item.label}</dt>
              <dd className="mt-1 font-headline text-xl font-semibold tabular-nums text-[var(--ref-on-surface)]">{item.value}</dd>
              {item.meter != null && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" aria-hidden>
                  <div className="h-full rounded-full bg-[var(--ref-primary)]" style={{ width: `${item.meter}%` }} />
                </div>
              )}
            </div>
          ))}
        </dl>

        <div className="mb-6">
          <CategoryBreakdown categories={allCategories} />
        </div>

        <section className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className={panelFrame}>
            <div className={panelHeader}>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Categories</h2>
                <p className="text-xs text-[var(--ref-on-surface-variant)]">Most used first. Click one to edit it.</p>
              </div>
              {archivedCount > 0 && (
                <button
                  type="button"
                  aria-pressed={showArchived}
                  onClick={() => setShowArchived((value) => !value)}
                  className={cn('shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors', showArchived ? 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]')}
                >
                  {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
                </button>
              )}
            </div>

            {isLoading ? (
              <p className="px-5 py-8 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
            ) : categories.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="mb-4 text-sm text-[var(--ref-on-surface-variant)]">No categories yet.</p>
                <Button onClick={() => openCategoryModal()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create category
                </Button>
              </div>
            ) : (
              // Two columns; the last row's bottom borders tuck under the panel's own border.
              <ul className="-mb-px grid sm:grid-cols-2">
                {orderedCategories.map((c) => {
                  const count = usage(c);
                  const color = c.color || 'var(--ref-primary)';
                  const reportingAccount = c.reportingAccountId ? expenseAccounts.find((a) => a.id === c.reportingAccountId)?.name ?? 'Mapped expense account' : null;
                  return (
                    <li key={c.id} className={cn('group flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3 transition-colors hover:bg-[var(--ref-surface-container-low)] sm:odd:border-r', !c.isActive && 'opacity-60')}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}>
                        <CategoryIcon name={c.name} color={color} />
                      </span>
                      <button type="button" onClick={() => openCategoryModal(c)} className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-[var(--ref-on-surface)]">{c.name}</span>
                          {!c.isActive && <span className="shrink-0 rounded-md bg-[var(--ref-surface-container-high)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ref-on-surface-variant)]">Archived</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--ref-on-surface-variant)]">
                          {count} {count === 1 ? 'transaction' : 'transactions'}{reportingAccount ? ` · reports to ${reportingAccount}` : ''}
                        </span>
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setMenuCategoryId(menuCategoryId === c.id ? null : c.id)
                          }
                          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--ref-on-surface-variant)] transition hover:bg-[var(--ref-surface-container-high)] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          aria-label={`More actions for ${c.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuCategoryId === c.id && (
                          <>
                            <button
                              type="button"
                              className="fixed inset-0 z-10 cursor-default"
                              aria-label="Close menu"
                              onClick={() => setMenuCategoryId(null)}
                            />
                            <div className="ui-popover absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1 shadow-xl">
                              <button
                                type="button"
                                className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-[var(--ref-surface-container-low)]"
                                onClick={() => {
                                  setMenuCategoryId(null);
                                  openCategoryModal(c);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={cn('block w-full rounded-lg px-3 py-1.5 text-left text-sm', c.isActive ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10' : 'hover:bg-[var(--ref-surface-container-low)]')}
                                onClick={() => {
                                  setMenuCategoryId(null);
                                  if (c.isActive) void handleDeleteCategory(c.id);
                                  else void handleRestoreCategory(c.id);
                                }}
                              >
                                {c.isActive ? 'Archive' : 'Restore'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <TagGroupsPanel
            className="xl:sticky xl:top-24"
            tags={tags}
            groups={tagGroups}
            uses={(tagId) => stats.byTag[tagId] ?? 0}
            loading={isLoading}
            onEditTag={(tag) => openTagModal(tag)}
            onAddTag={() => openTagModal()}
          />
        </section>

        <Modal
          isOpen={isCategoryModalOpen}
          onClose={closeCategoryModal}
          title={editingCategory ? 'Edit category' : 'New category'}
        >
          <form onSubmit={handleCategorySubmit} className="space-y-4">
            <Input
              label="Name"
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
              required
            />
            <div>
              <p className="mb-2 block font-mono text-sm font-medium">Icon</p>
              <div className="flex items-center gap-3 text-sm text-[var(--ref-on-surface-variant)]">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--ref-surface-container-low)]">
                  <CategoryIcon name={categoryForm.name} color={categoryForm.color} className="h-5 w-5" />
                </span>
                Picked from the name, in the category's colour.
              </div>
            </div>
            <div>
              <label className="mb-2 block font-mono text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => {
                  const isUsed = usedCategoryColors.has(color);
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => { setCategoryForm({ ...categoryForm, color }); setFormError(''); }}
                      disabled={isUsed}
                      aria-label={`${color}${isUsed ? ', already used by another category' : ''}`}
                      aria-pressed={categoryForm.color.toUpperCase() === color}
                      title={isUsed ? 'Already used by another category' : color}
                      className={cn(
                        'h-9 w-9 rounded-full border-2 disabled:cursor-not-allowed disabled:opacity-25',
                        categoryForm.color.toUpperCase() === color
                          ? 'border-[var(--color-text-primary)]'
                          : 'border-transparent',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  );
                })}
                <label className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[var(--color-border)] text-xs font-bold" title="Choose a custom color">
                  <span aria-hidden="true">+</span>
                  <input
                    type="color"
                    value={/^#[0-9A-Fa-f]{6}$/.test(categoryForm.color) ? categoryForm.color : '#000000'}
                    aria-label="Choose a custom category color"
                    className="sr-only"
                    onChange={(event) => {
                      const color = event.target.value.toUpperCase();
                      if (usedCategoryColors.has(color)) {
                        setFormError('That color is already assigned to another category.');
                        return;
                      }
                      setCategoryForm({ ...categoryForm, color });
                      setFormError('');
                    }}
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Each category needs a unique color. Used colors are dimmed.</p>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Reporting expense account</label>
              <select
                value={categoryForm.reportingAccountId}
                onChange={(e) => setCategoryForm({ ...categoryForm, reportingAccountId: e.target.value })}
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)]"
              >
                <option value="">Use default expense account</option>
                {expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">New simple expenses use this account; category totals still come from allocations.</p>
            </div>
            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}
            <div className="flex gap-3 pt-4">
              <Button type="submit" isLoading={isSubmitting} className="flex-1">
                {editingCategory ? 'Save' : 'Create'}
              </Button>
              <Button type="button" variant="secondary" onClick={closeCategoryModal}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>

        <Modal isOpen={isTagModalOpen} onClose={closeTagModal} title={editingTag ? 'Edit tag' : 'New tag'}>
          <form onSubmit={handleTagSubmit} className="space-y-4">
            {tagGroups.length > 0 && (
              <label className="block">
                <span className="mb-2 block font-mono text-sm font-medium">Group</span>
                <select
                  value={tagForm.groupId}
                  onChange={(e) => setTagForm({ ...tagForm, groupId: e.target.value })}
                  className="block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"
                >
                  <option value="">Ungrouped</option>
                  {[...tagGroups].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((group) => <option key={group.id} value={String(group.id)}>{group.name}</option>)}
                </select>
              </label>
            )}
            <Input
              label="Name"
              value={tagForm.name}
              onChange={(e) => setTagForm({ ...tagForm, name: e.target.value })}
              required
            />
            <div>
              <label className="mb-2 block font-mono text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setTagForm({ ...tagForm, color })}
                    className={cn(
                      'h-9 w-9 rounded-full border-2',
                      tagForm.color === color ? 'border-[var(--color-text-primary)]' : 'border-transparent',
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}
            <div className="flex flex-wrap gap-3 pt-4">
              <Button type="submit" isLoading={isSubmitting} className="flex-1">
                {editingTag ? 'Save' : 'Create'}
              </Button>
              {editingTag && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={async () => {
                    const confirmed = await confirm({
                      title: 'Delete Tag',
                      message: 'Are you sure you want to delete this tag?',
                      confirmLabel: 'Delete',
                      variant: 'danger',
                    });
                    if (!confirmed) return;
                    try {
                      await deleteTagMutation.mutateAsync(editingTag.id);
                      closeTagModal();
                      toast.success('Tag deleted');
                    } catch (err) {
                      toast.error('Could not delete tag', errorMessage(err));
                    }
                  }}
                >
                  Delete
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={closeTagModal}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      </PageContainer>
    </RequireAuth>
  );
}
