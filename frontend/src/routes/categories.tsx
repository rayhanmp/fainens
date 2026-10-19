import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { useMemo, useState } from 'react';
import { useCategoriesPageQuery } from '../features/categories/page-queries';
import { CategoryIcon } from '../features/categories/CategoryIcon';
import { CategoryBreakdown } from '../features/categories/CategoryBreakdown';
import { CategoryTrendTable, PeriodSpendChart } from '../features/categories/CategoryTrends';
import { TagGroupsPanel } from '../features/categories/TagGroupsPanel';
import { RelatedTransactionsModal, type RelatedSubject } from '../features/categories/RelatedTransactionsModal';
import { ColorPicker, Field, textInputClass } from '../features/categories/EditorParts';
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
  // The category in focus in "Spending by period", set from its legend or a trend row.
  const [trendFocus, setTrendFocus] = useState<number | null>(null);
  // The category or tag whose entries are open in the related-transactions modal.
  const [related, setRelated] = useState<RelatedSubject | null>(null);

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
            { label: 'Categories', short: 'Categories', value: String(allCategories.filter((category) => category.isActive).length), meter: null },
            { label: 'Tags', short: 'Tags', value: String(tags.length), meter: null },
            { label: 'Spending categorized', short: 'Categorized', value: `${stats.categorizedPct}%`, meter: stats.categorizedPct },
            { label: 'Entries tagged', short: 'Tagged', value: `${stats.taggedPct}%`, meter: stats.taggedPct },
          ].map((item) => (
            // One line per stat; a meter runs along the cell's bottom edge instead of adding a row.
            // Phones get the short label so it isn't cut off in half the width.
            <div key={item.label} className="relative flex items-baseline justify-between gap-3 bg-[var(--ref-surface-container-lowest)] px-4 py-2.5 sm:px-5">
              <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-[var(--ref-on-surface-variant)] sm:tracking-wider"><span className="sm:hidden">{item.short}</span><span className="hidden sm:inline">{item.label}</span></dt>
              <dd className="font-headline text-lg font-semibold tabular-nums text-[var(--ref-on-surface)]">{item.value}</dd>
              {item.meter != null && (
                <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--ref-surface-container-high)]" aria-hidden>
                  <div className="h-full bg-[var(--ref-primary)]" style={{ width: `${item.meter}%` }} />
                </div>
              )}
            </div>
          ))}
        </dl>

        {/* Both panels share the row's height, so the category list never ends short of the tags; the
            tags get a wide column so their chips wrap into fewer rows and the row stays short. */}
        <section className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className={cn(panelFrame, 'flex flex-col')}>
            <div className={panelHeader}>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Categories</h2>
                <p className="text-xs text-[var(--ref-on-surface-variant)]">Most used first. Click one to see its entries.</p>
              </div>
              {archivedCount > 0 && (
                <button
                  type="button"
                  aria-pressed={showArchived}
                  onClick={() => setShowArchived((value) => !value)}
                  className={cn('touch-hit shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors', showArchived ? 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]')}
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
              // Two columns of equal-height rows that fill the panel; the last row's bottom borders tuck
              // under the panel's own border.
              <ul className="-mb-px grid flex-1 auto-rows-fr sm:grid-cols-2">
                {orderedCategories.map((c) => {
                  const count = usage(c);
                  const color = c.color || 'var(--ref-primary)';
                  const reportingAccount = c.reportingAccountId ? expenseAccounts.find((a) => a.id === c.reportingAccountId)?.name ?? 'Mapped expense account' : null;
                  return (
                    <li key={c.id} className={cn('group flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3 transition-colors hover:bg-[var(--ref-surface-container-low)] sm:odd:border-r', !c.isActive && 'opacity-60')}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}>
                        <CategoryIcon name={c.name} color={color} />
                      </span>
                      <button type="button" onClick={() => setRelated({ kind: 'category', id: c.id, name: c.name, color: c.color ?? null })} className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]">
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
            onOpenTag={(tag) => setRelated({ kind: 'tag', id: tag.id, name: tag.name, color: tag.color ?? null })}
            onAddTag={() => openTagModal()}
          />
        </section>

        <section className="mt-6 space-y-6" aria-label="Insights">
          <PeriodSpendChart categories={allCategories} focus={trendFocus} onFocusChange={setTrendFocus} onOpen={setRelated} />

          {/* grid-cols-1 is minmax(0,1fr): without it the single phone column grows to its widest content. */}
          <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <CategoryBreakdown categories={allCategories} onOpen={setRelated} />
            <CategoryTrendTable
              categories={allCategories}
              focus={trendFocus}
              onOpen={setRelated}
              onSelect={(id) => {
                setTrendFocus((current) => (current === id ? null : id));
                document.getElementById('spending-by-period')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          </div>
        </section>

        <RelatedTransactionsModal
          subject={related}
          categories={allCategories}
          onClose={() => setRelated(null)}
          onEdit={(subject) => {
            setRelated(null);
            if (subject.kind === 'category') {
              const category = allCategories.find((item) => item.id === subject.id);
              if (category) openCategoryModal(category);
            } else {
              const tag = tags.find((item) => item.id === subject.id);
              if (tag) openTagModal(tag);
            }
          }}
        />

        <Modal
          isOpen={isCategoryModalOpen}
          onClose={closeCategoryModal}
          title={editingCategory ? 'Edit category' : 'New category'}
          footer={(
            <div className="flex items-center gap-2">
              {editingCategory && (
                <button
                  type="button"
                  onClick={() => {
                    const category = editingCategory;
                    closeCategoryModal();
                    if (category.isActive) void handleDeleteCategory(category.id);
                    else void handleRestoreCategory(category.id);
                  }}
                  className={cn('rounded-lg px-3 py-2 text-sm font-medium', editingCategory.isActive ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10' : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]')}
                >
                  {editingCategory.isActive ? 'Archive' : 'Restore'}
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={closeCategoryModal} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]">Cancel</button>
                <Button type="submit" form="category-form" isLoading={isSubmitting}>{editingCategory ? 'Save changes' : 'Create category'}</Button>
              </div>
            </div>
          )}
        >
          <form id="category-form" onSubmit={handleCategorySubmit} className="space-y-5">
            {/* Live preview: how the category shows up across the app. */}
            <div className="flex items-center gap-3.5 rounded-2xl p-3.5" style={{ backgroundColor: `color-mix(in srgb, ${categoryForm.color} 10%, transparent)` }}>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ backgroundColor: `color-mix(in srgb, ${categoryForm.color} 20%, var(--ref-surface-container-lowest))` }}>
                <CategoryIcon name={categoryForm.name} color={categoryForm.color} className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-headline text-lg font-bold text-[var(--ref-on-surface)]">{categoryForm.name.trim() || 'New category'}</p>
                <p className="text-xs text-[var(--ref-on-surface-variant)]">
                  {editingCategory ? `${stats.byCat[editingCategory.id] ?? 0} transactions · ` : ''}The icon follows the name
                </p>
              </div>
            </div>

            <Field label="Name" htmlFor="category-name">
              <input id="category-name" required value={categoryForm.name} placeholder="e.g. Groceries" onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} className={textInputClass} />
            </Field>

            <Field label="Colour" hint="Each category has its own colour; ones already taken are struck through.">
              <ColorPicker
                label="Category colour"
                colors={PRESET_COLORS}
                value={categoryForm.color}
                taken={usedCategoryColors}
                onTaken={() => setFormError('That colour already belongs to another category.')}
                onChange={(color) => { setCategoryForm({ ...categoryForm, color }); setFormError(''); }}
              />
            </Field>

            <details className="group rounded-xl border border-[var(--color-border)] px-3.5 py-2.5" open={Boolean(categoryForm.reportingAccountId)}>
              <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-[var(--ref-on-surface-variant)]">
                Accounting
                <span className="font-normal">{categoryForm.reportingAccountId ? expenseAccounts.find((account) => String(account.id) === categoryForm.reportingAccountId)?.name : 'Default expense account'}</span>
              </summary>
              <div className="mt-3">
                <Field label="Reporting expense account" htmlFor="category-account" hint="New simple expenses post to this account; category totals still come from allocations.">
                  <select id="category-account" value={categoryForm.reportingAccountId} onChange={(e) => setCategoryForm({ ...categoryForm, reportingAccountId: e.target.value })} className={textInputClass}>
                    <option value="">Default expense account</option>
                    {expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </Field>
              </div>
            </details>

            {formError && <p className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{formError}</p>}
          </form>
        </Modal>

        <Modal
          isOpen={isTagModalOpen}
          onClose={closeTagModal}
          title={editingTag ? 'Edit tag' : 'New tag'}
          footer={(
            <div className="flex items-center gap-2">
              {editingTag && (
                <button
                  type="button"
                  onClick={async () => {
                    const uses = stats.byTag[editingTag.id] ?? 0;
                    const confirmed = await confirm({
                      title: 'Delete tag',
                      message: uses > 0 ? `Delete "${editingTag.name}"? It comes off the ${uses} transaction${uses === 1 ? '' : 's'} that carry it; the transactions stay.` : `Delete "${editingTag.name}"?`,
                      confirmLabel: 'Delete tag',
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
                  className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                >
                  Delete
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={closeTagModal} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]">Cancel</button>
                <Button type="submit" form="tag-form" isLoading={isSubmitting}>{editingTag ? 'Save changes' : 'Create tag'}</Button>
              </div>
            </div>
          )}
        >
          <form id="tag-form" onSubmit={handleTagSubmit} className="space-y-5">
            {/* Live preview of the chip. */}
            <div className="grid place-items-center rounded-2xl bg-[var(--ref-surface-container-low)] px-4 py-6">
              <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3.5 py-2 text-sm font-semibold text-[var(--ref-on-surface)] shadow-sm">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tagForm.color }} aria-hidden />
                {tagForm.name.trim() || 'New tag'}
                {editingTag && <span className="font-normal tabular-nums text-[var(--ref-on-surface-variant)]">{stats.byTag[editingTag.id] ?? 0}</span>}
              </span>
            </div>

            <Field label="Name" htmlFor="tag-name">
              <input id="tag-name" required value={tagForm.name} placeholder="e.g. Bali trip" onChange={(e) => setTagForm({ ...tagForm, name: e.target.value })} className={textInputClass} />
            </Field>

            {tagGroups.length > 0 && (
              <Field label="Group">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Group">
                  {[{ id: '', name: 'Ungrouped' }, ...[...tagGroups].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((group) => ({ id: String(group.id), name: group.name }))].map((group) => (
                    <button
                      key={group.id || 'none'}
                      type="button"
                      role="radio"
                      aria-checked={tagForm.groupId === group.id}
                      onClick={() => setTagForm({ ...tagForm, groupId: group.id })}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                        tagForm.groupId === group.id
                          ? 'border-[var(--ref-primary)] bg-[color-mix(in_srgb,var(--ref-primary)_10%,transparent)] text-[var(--ref-on-surface)]'
                          : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]',
                      )}
                    >
                      {group.name}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Colour">
              <ColorPicker label="Tag colour" colors={PRESET_COLORS} value={tagForm.color} onChange={(color) => setTagForm({ ...tagForm, color })} />
            </Field>

            {formError && <p className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{formError}</p>}
          </form>
        </Modal>
      </PageContainer>
    </RequireAuth>
  );
}
