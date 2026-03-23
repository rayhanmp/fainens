import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Plus,
  Sparkles,
  Wand2,
  ChevronRight,
  Archive,
  MoreVertical,
} from 'lucide-react';

export const Route = createFileRoute('/categories')({
  component: CategoriesPage,
} as any);

interface Category {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
}

interface TagRow {
  id: number;
  name: string;
  color: string;
}

interface TxRow {
  id: number;
  categoryId: number | null;
  tags: Array<{ tagId: number; name: string; color: string }>;
}

const PRESET_COLORS = [
  '#F59E0B',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#10B981',
  '#64748B',
  '#EF4444',
  '#14B8A6',
];

function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingTag, setEditingTag] = useState<TagRow | null>(null);

  const [categoryForm, setCategoryForm] = useState({ name: '', icon: '📌', color: PRESET_COLORS[0] });
  const [tagForm, setTagForm] = useState({ name: '', color: PRESET_COLORS[0] });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [menuCategoryId, setMenuCategoryId] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [catData, tagData, txData] = await Promise.all([
        api.categories.list(),
        api.tags.list(),
        api.transactions.list({ limit: '2000' }),
      ]);
      setCategories(catData);
      setTags(tagData);
      setTransactions(txData as TxRow[]);
    } finally {
      setIsLoading(false);
    }
  };

  const stats = useMemo(() => {
    const byCat: Record<number, number> = {};
    const byTag: Record<number, number> = {};
    let categorized = 0;
    let tagged = 0;
    for (const tx of transactions) {
      if (tx.categoryId != null) {
        categorized++;
        byCat[tx.categoryId] = (byCat[tx.categoryId] ?? 0) + 1;
      }
      if (tx.tags.length) {
        tagged++;
        for (const t of tx.tags) {
          byTag[t.tagId] = (byTag[t.tagId] ?? 0) + 1;
        }
      }
    }
    const n = transactions.length;
    return {
      byCat,
      byTag,
      categorizedPct: n ? Math.round((categorized / n) * 100) : 0,
      taggedPct: n ? Math.round((tagged / n) * 100) : 0,
    };
  }, [transactions]);

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSubmitting(true);
    try {
      if (editingCategory) {
        await api.categories.update(editingCategory.id, {
          name: categoryForm.name,
          icon: categoryForm.icon || null,
          color: categoryForm.color || null,
        });
      } else {
        await api.categories.create({
          name: categoryForm.name,
          icon: categoryForm.icon || null,
          color: categoryForm.color || null,
        });
      }
      await loadData();
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
      if (editingTag) {
        await api.tags.update(editingTag.id, tagForm);
      } else {
        await api.tags.create(tagForm);
      }
      await loadData();
      closeTagModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('Delete this category?')) return;
    try {
      await api.categories.delete(id);
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleDeleteTag = async (id: number) => {
    if (!confirm('Delete this tag?')) return;
    try {
      await api.tags.delete(id);
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const openCategoryModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setCategoryForm({
        name: category.name,
        icon: category.icon || '📌',
        color: category.color || PRESET_COLORS[0],
      });
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '', icon: '📌', color: PRESET_COLORS[0] });
    }
    setFormError('');
    setIsCategoryModalOpen(true);
  };

  const openTagModal = (tag?: TagRow) => {
    if (tag) {
      setEditingTag(tag);
      setTagForm({ name: tag.name, color: tag.color });
    } else {
      setEditingTag(null);
      setTagForm({ name: '', color: PRESET_COLORS[0] });
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

  return (
    <RequireAuth>
      <div className="pb-12">
        {/* Hero — Stitch Categories & Tags Management */}
        <header className="mb-10 lg:mb-12">
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-[var(--ref-tertiary)]">
            Internal organization
          </span>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="font-headline text-3xl font-extrabold leading-none tracking-tight text-[var(--color-text-primary)] sm:text-4xl md:text-5xl">
                Ledger classification
              </h1>
              <p className="mt-4 max-w-xl text-lg text-[var(--color-text-secondary)] font-body">
                Manage how spending is categorized and tagged across every transaction.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openCategoryModal()}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ref-secondary-container)] px-6 py-3 text-sm font-bold text-[var(--ref-on-secondary-container)] shadow-sm transition-all hover:shadow-md"
              >
                <Plus className="h-4 w-4" />
                New category
              </button>
              <button
                type="button"
                disabled
                title="Coming soon"
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-[var(--color-accent)] px-6 py-3 text-sm font-bold text-white opacity-60 shadow-md shadow-[var(--color-accent)]/20"
              >
                <Wand2 className="h-4 w-4" />
                Auto-rules
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
          {/* Categories — left */}
          <div className="lg:col-span-9">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="font-headline text-lg font-bold text-[var(--color-text-primary)]">
                Categories
              </h2>
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                {categories.length} total
              </span>
            </div>

            {isLoading ? (
              <p className="text-[var(--color-text-secondary)]">Loading…</p>
            ) : categories.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-10 text-center">
                <p className="mb-4 text-[var(--color-text-secondary)]">No categories yet.</p>
                <Button onClick={() => openCategoryModal()} className="rounded-full">
                  <Plus className="mr-2 h-4 w-4" />
                  Create category
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((c) => {
                  const count = stats.byCat[c.id] ?? 0;
                  const bgTint = c.color ? `${c.color}22` : 'var(--ref-primary-fixed)';
                  return (
                    <div
                      key={c.id}
                      className="group relative flex items-center gap-3 rounded-xl bg-[var(--ref-surface-container-lowest)] p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:translate-y-[-2px]"
                    >
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl cursor-pointer"
                        style={{
                          backgroundColor: bgTint,
                          color: c.color || 'var(--color-accent)',
                        }}
                        onClick={() => openCategoryModal(c)}
                      >
                        {c.icon || '📁'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3
                          className="font-headline text-base font-bold text-[var(--color-text-primary)] truncate cursor-pointer hover:text-[var(--color-accent)] transition-colors"
                          onClick={() => openCategoryModal(c)}
                        >
                          {c.name}
                        </h3>
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          {count} txns
                        </p>
                      </div>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setMenuCategoryId(menuCategoryId === c.id ? null : c.id)
                          }
                          className="rounded-lg p-1.5 opacity-60 transition-all hover:bg-[var(--ref-surface-container-low)] hover:opacity-100 cursor-pointer"
                          aria-label="More actions"
                        >
                          <MoreVertical className="h-4 w-4 text-[var(--color-muted)]" />
                        </button>
                        {menuCategoryId === c.id && (
                          <>
                            <button
                              type="button"
                              className="fixed inset-0 z-10 cursor-default"
                              aria-label="Close menu"
                              onClick={() => setMenuCategoryId(null)}
                            />
                            <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
                              <button
                                type="button"
                                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--ref-surface-container-low)] cursor-pointer"
                                onClick={() => {
                                  setMenuCategoryId(null);
                                  openCategoryModal(c);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer"
                                onClick={() => {
                                  setMenuCategoryId(null);
                                  handleDeleteCategory(c.id);
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Smart rules — placeholder */}
            <div className="mt-8 rounded-xl bg-[var(--ref-surface-container-low)] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-headline text-sm font-bold text-[var(--color-text-primary)]">
                    Auto-rules
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Auto-categorize by merchant (coming soon)
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tags + stats — right sticky */}
          <div className="lg:col-span-3">
            <div className="space-y-10 lg:sticky lg:top-24">
              <div>
                <div className="mb-8 flex items-center justify-between">
                  <h2 className="font-headline text-2xl font-bold text-[var(--color-text-primary)]">
                    Global tags
                  </h2>
                  <button
                    type="button"
                    onClick={() => openTagModal()}
                    className="rounded-full p-2 text-[var(--color-accent)] transition-colors hover:bg-[var(--ref-primary-fixed)]"
                    title="Add tag"
                  >
                    <Plus className="h-6 w-6" />
                  </button>
                </div>

                {isLoading ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">Loading tags…</p>
                ) : tags.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    No tags yet. Add tags to label trips, work, reimbursements, etc.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {tags.map((tag) => {
                      const uses = stats.byTag[tag.id] ?? 0;
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => openTagModal(tag)}
                          className="group flex items-center gap-2 rounded-full px-4 py-2 text-left transition-all bg-[var(--ref-surface-container)] border border-[var(--color-border)] hover:bg-[var(--ref-surface-container-highest)]"
                        >
                          <span className="text-sm font-medium text-[var(--color-text-secondary)]">#{tag.name}</span>
                          <span className="text-[10px] font-bold text-[var(--color-muted)]">{uses}x</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Classification health */}
              <div className="rounded-3xl bg-[var(--ref-surface-container-lowest)] p-8 shadow-sm">
                <h3 className="mb-6 font-headline text-lg font-bold text-[var(--color-text-primary)]">
                  Classification health
                </h3>
                <div className="space-y-6">
                  <div>
                    <div className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wider">
                      <span className="text-[var(--color-text-secondary)]">Categorized</span>
                      <span className="text-[var(--color-success)]">{stats.categorizedPct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-success)] transition-all"
                        style={{ width: `${stats.categorizedPct}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wider">
                      <span className="text-[var(--color-text-secondary)]">Tagged</span>
                      <span className="text-[var(--ref-tertiary)]">{stats.taggedPct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]">
                      <div
                        className="h-full rounded-full bg-[var(--ref-tertiary)] transition-all"
                        style={{ width: `${stats.taggedPct}%` }}
                      />
                    </div>
                  </div>
                </div>
                <p className="mt-8 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  A higher rate keeps reports and budgets aligned with how you actually spend.
                </p>
              </div>

              {/* Archival placeholder */}
              <button
                type="button"
                disabled
                className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-[var(--color-border)]/50 p-6 text-left opacity-70 transition-colors"
              >
                <Archive className="h-5 w-5 shrink-0 text-[var(--color-muted)]" />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-[var(--color-text-primary)]">
                    Archive cleanup
                  </h4>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Find unused tags and categories (coming soon)
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted)]" />
              </button>
            </div>
          </div>
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
            <Input
              label="Icon (emoji)"
              value={categoryForm.icon}
              onChange={(e) => setCategoryForm({ ...categoryForm, icon: e.target.value })}
            />
            <div>
              <label className="mb-2 block font-mono text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setCategoryForm({ ...categoryForm, color })}
                    className={cn(
                      'h-9 w-9 rounded-full border-2',
                      categoryForm.color === color
                        ? 'border-[var(--color-text-primary)]'
                        : 'border-transparent',
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
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
                    if (!confirm('Delete this tag?')) return;
                    try {
                      await api.tags.delete(editingTag.id);
                      await loadData();
                      closeTagModal();
                    } catch (err) {
                      alert((err as Error).message);
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
      </div>
    </RequireAuth>
  );
}
