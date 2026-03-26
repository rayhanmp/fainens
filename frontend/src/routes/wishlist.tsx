import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { 
  Sparkles, 
  MoreVertical, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Link as LinkIcon,
  ShoppingBag,
  Plane,
  Heart
} from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { formatCurrency, cn } from '../lib/utils';
import { CreateWishlistModal } from '../components/wishlist/CreateWishlistModal';
import { FulfillWishlistModal } from '../components/wishlist/FulfillWishlistModal';
import { LinkTransactionModal } from '../components/wishlist/LinkTransactionModal';

export const Route = createFileRoute('/wishlist')({
  component: WishlistPage,
} as any);

interface WishlistItem {
  id: number;
  name: string;
  description: string | null;
  amount: number;
  status: 'active' | 'fulfilled' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  fulfilledAt: number | null;
  fulfilledTransactionId: number | null;
  categoryId: number | null;
  periodId: number | null;
  imageUrl: string | null;
  category: {
    id: number;
    name: string;
    icon: string | null;
    color: string | null;
  } | null;
  period: {
    id: number;
    name: string;
    startDate: number;
    endDate: number;
  } | null;
}

type FilterStatus = 'all' | 'active' | 'fulfilled';
type FilterCategory = 'all' | number;

export default function WishlistPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string; icon: string | null; color: string | null }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('active');
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [fulfillItem, setFulfillItem] = useState<WishlistItem | null>(null);
  const [linkItem, setLinkItem] = useState<WishlistItem | null>(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<WishlistItem | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setIsLoading(true);
      const [wishlistData, categoriesData] = await Promise.all([
        api.wishlist.list(),
        api.categories.list(),
      ]);
      setItems(wishlistData);
      setCategories(categoriesData);
    } catch (err) {
      console.error('Failed to load wishlist:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const filteredItems = items.filter(item => {
    if (filterStatus !== 'all' && item.status !== filterStatus) return false;
    if (filterCategory !== 'all' && item.categoryId !== filterCategory) return false;
    return true;
  });

  const activeItems = filteredItems.filter(item => item.status === 'active');
  const fulfilledItems = filteredItems.filter(item => item.status === 'fulfilled');

  const totalTargetAmount = activeItems.reduce((sum, item) => sum + item.amount, 0);
  const totalFulfilledAmount = fulfilledItems.reduce((sum, item) => sum + item.amount, 0);

  async function handleDelete(item: WishlistItem) {
    try {
      await api.wishlist.delete(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      setDeleteConfirmItem(null);
      setActiveMenuId(null);
    } catch (err) {
      console.error('Failed to delete wishlist item:', err);
      alert('Failed to delete item');
    }
  }

  function handleFulfillSuccess() {
    loadData();
    setFulfillItem(null);
    setLinkItem(null);
  }

  function getCategoryIcon(categoryId: number | null) {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return <ShoppingBag className="w-4 h-4" />;
    
    // Map category names to icons
    const name = category.name.toLowerCase();
    if (name.includes('travel') || name.includes('trip')) return <Plane className="w-4 h-4" />;
    if (name.includes('tech') || name.includes('gadget')) return <ShoppingBag className="w-4 h-4" />;
    if (name.includes('lifestyle')) return <Heart className="w-4 h-4" />;
    return <ShoppingBag className="w-4 h-4" />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent)]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <section>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <PageHeader
            subtext="Savings goals"
            title="Wishlist"
            description="Plan your future purchases and financial goals. Track what you're saving for and fulfill them when ready."
          />
          <div className="bg-[var(--ref-surface-container-low)] px-8 py-6 rounded-xl text-right">
            <span className="block text-xs font-bold text-[var(--color-accent)] uppercase tracking-widest mb-1">
              Target Amount
            </span>
            <span className="text-3xl font-bold font-headline text-[var(--color-text-primary)]">
              {formatCurrency(totalTargetAmount)}
            </span>
          </div>
        </div>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {/* Status filters */}
          <button
            onClick={() => setFilterStatus('active')}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
              filterStatus === 'active'
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--ref-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-highest)]'
            )}
          >
            Active ({activeItems.length})
          </button>
          <button
            onClick={() => setFilterStatus('fulfilled')}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
              filterStatus === 'fulfilled'
                ? 'bg-[var(--color-success)] text-white'
                : 'bg-[var(--ref-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-highest)]'
            )}
          >
            Fulfilled ({fulfilledItems.length})
          </button>
          <button
            onClick={() => setFilterStatus('all')}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
              filterStatus === 'all'
                ? 'bg-[var(--color-text-primary)] text-white'
                : 'bg-[var(--ref-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-highest)]'
            )}
          >
            All ({items.length})
          </button>

          {/* Divider */}
          <div className="w-px h-8 bg-[var(--color-border)] mx-2" />

          {/* Category filters */}
          <button
            onClick={() => setFilterCategory('all')}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
              filterCategory === 'all'
                ? 'bg-[var(--ref-primary-container)] text-[var(--ref-on-primary-container)]'
                : 'bg-[var(--ref-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-highest)]'
            )}
          >
            All Categories
          </button>
          {categories.slice(0, 5).map(category => (
            <button
              key={category.id}
              onClick={() => setFilterCategory(category.id)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
                filterCategory === category.id
                  ? 'bg-[var(--ref-primary-container)] text-[var(--ref-on-primary-container)]'
                  : 'bg-[var(--ref-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-highest)]'
              )}
            >
              {category.name}
            </button>
          ))}
        </div>

        <Button onClick={() => setIsCreateModalOpen(true)} className="rounded-full">
          <Plus className="w-4 h-4 mr-2" />
          Add Wishlist
        </Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main Content - Active Targets */}
        <div className="flex-grow lg:w-2/3">
          {activeItems.length === 0 ? (
            <div className="text-center py-16 bg-[var(--ref-surface-container-low)] rounded-2xl">
              <Sparkles className="w-16 h-16 mx-auto text-[var(--color-muted)] mb-4" />
              <h3 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
                {filterStatus === 'active' ? 'No active wishlist items' : 'No items match your filters'}
              </h3>
              <p className="text-[var(--color-text-secondary)] mb-6">
                {filterStatus === 'active' 
                  ? 'Start planning your future purchases by adding items to your wishlist.'
                  : 'Try adjusting your filters to see more items.'}
              </p>
              {filterStatus === 'active' && (
                <Button onClick={() => setIsCreateModalOpen(true)} className="rounded-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Wishlist
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {activeItems.map(item => (
                <div
                  key={item.id}
                  className="group relative bg-[var(--ref-surface-container-lowest)] rounded-xl p-6 flex flex-col justify-between min-h-[200px] border border-transparent hover:border-[var(--color-border)] transition-all shadow-sm"
                >
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest',
                        item.category?.color 
                          ? 'bg-opacity-10' 
                          : 'bg-[var(--ref-surface-container-high)] text-[var(--color-text-secondary)]'
                      )}>
                        <span className="flex items-center gap-1">
                          {getCategoryIcon(item.categoryId)}
                          {item.category?.name || 'Uncategorized'}
                        </span>
                      </div>
                      <div className="relative">
                        <button
                          onClick={() => setActiveMenuId(activeMenuId === item.id ? null : item.id)}
                          className="cursor-pointer p-1 hover:bg-[var(--ref-surface-container-high)] rounded-full transition-colors"
                        >
                          <MoreVertical className="w-4 h-4 text-[var(--color-muted)]" />
                        </button>
                        
                        {activeMenuId === item.id && (
                          <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-1 shadow-lg">
                            <button
                              onClick={() => {
                                setFulfillItem(item);
                                setActiveMenuId(null);
                              }}
                              className="cursor-pointer w-full px-4 py-2.5 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)] flex items-center gap-2"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              Mark as Fulfilled
                            </button>
                            <button
                              onClick={() => {
                                setLinkItem(item);
                                setActiveMenuId(null);
                              }}
                              className="cursor-pointer w-full px-4 py-2.5 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)] flex items-center gap-2"
                            >
                              <LinkIcon className="w-4 h-4" />
                              Link to Transaction
                            </button>
                            <div className="border-t border-[var(--color-border)] my-1" />
                            <button
                              onClick={() => {
                                setDeleteConfirmItem(item);
                                setActiveMenuId(null);
                              }}
                              className="cursor-pointer w-full px-4 py-2.5 text-left text-sm font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 flex items-center gap-2"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Product Image */}
                    {item.imageUrl && (
                      <div className="mb-4 flex justify-center">
                        <img 
                          src={`/api/wishlist-images/${item.imageUrl}`}
                          alt={item.name}
                          className="max-h-40 object-contain rounded-lg"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    
                    <h3 className="text-xl font-bold font-headline text-[var(--color-text-primary)] mb-1">
                      {item.name}
                    </h3>
                    {item.description && (
                      <p className="text-[var(--color-text-secondary)] text-sm mb-3">{item.description}</p>
                    )}
                    <div className="text-2xl font-bold text-[var(--color-accent)]">
                      {formatCurrency(item.amount)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)] mt-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[var(--color-warning)] animate-pulse" />
                      <span className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">
                        {item.period ? `Saving for ${item.period.name}` : 'Pending'}
                      </span>
                    </div>
                    {item.period && (
                      <span className="text-[10px] text-[var(--color-muted)]">
                        {new Date(item.period.startDate).toLocaleDateString()} - {new Date(item.period.endDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column - Fulfilled History */}
        <div className="lg:w-1/3">
          <div className="bg-[var(--ref-surface-container-low)] rounded-2xl p-6 border border-[var(--color-border)]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold font-headline text-[var(--color-text-primary)]">
                Fulfilled History
              </h2>
              <span className="bg-[var(--ref-secondary-container)] text-[var(--ref-on-secondary-container)] text-[10px] font-bold px-2 py-1 rounded-full">
                {fulfilledItems.length} SETTLED
              </span>
            </div>

            {fulfilledItems.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 mx-auto text-[var(--color-muted)] mb-3" />
                <p className="text-sm text-[var(--color-text-secondary)]">
                  No fulfilled items yet.
                </p>
                <p className="text-xs text-[var(--color-muted)] mt-1">
                  Your completed goals will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {fulfilledItems.slice(0, 5).map(item => (
                  <div
                    key={item.id}
                    className="bg-[var(--ref-surface-container-lowest)] p-4 rounded-xl flex items-center gap-4 border-l-4 border-[var(--color-success)] shadow-sm cursor-pointer hover:bg-[var(--ref-surface-container-high)] transition-colors"
                    onClick={() => item.fulfilledTransactionId && navigate({ to: '/transactions', search: { highlight: item.fulfilledTransactionId } })}
                  >
                    {item.imageUrl ? (
                      <img 
                        src={`/api/wishlist-images/${item.imageUrl}`}
                        alt={item.name}
                        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 bg-[var(--ref-secondary-container)] rounded-full flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="w-5 h-5 text-[var(--ref-on-secondary-container)]" />
                      </div>
                    )}
                    <div className="flex-grow min-w-0">
                      <div className="text-sm font-bold text-[var(--color-text-primary)] leading-tight truncate">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-tight">
                        Fulfilled {item.fulfilledAt ? new Date(item.fulfilledAt).toLocaleDateString() : 'Unknown'}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-[var(--color-success)]">
                      {formatCurrency(item.amount)}
                    </div>
                  </div>
                ))}

                {fulfilledItems.length > 5 && (
                  <button 
                    onClick={() => setFilterStatus('fulfilled')}
                    className="cursor-pointer w-full py-3 text-xs font-bold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 rounded-lg transition-colors border border-dashed border-[var(--color-accent)]/30"
                  >
                    VIEW COMPLETE HISTORY ({fulfilledItems.length} ITEMS)
                  </button>
                )}
              </div>
            )}

            {totalFulfilledAmount > 0 && (
              <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--color-text-secondary)]">Total Fulfilled</span>
                  <span className="text-lg font-bold text-[var(--color-success)]">
                    {formatCurrency(totalFulfilledAmount)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <CreateWishlistModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleFulfillSuccess}
        categories={categories}
      />

      {fulfillItem && (
        <FulfillWishlistModal
          isOpen={!!fulfillItem}
          onClose={() => setFulfillItem(null)}
          onSuccess={handleFulfillSuccess}
          item={fulfillItem}
        />
      )}

      {linkItem && (
        <LinkTransactionModal
          isOpen={!!linkItem}
          onClose={() => setLinkItem(null)}
          onSuccess={handleFulfillSuccess}
          item={linkItem}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--ref-surface-container-lowest)] rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
              Delete Wishlist Item?
            </h3>
            <p className="text-[var(--color-text-secondary)] mb-6">
              Are you sure you want to delete "{deleteConfirmItem.name}"? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => setDeleteConfirmItem(null)}
                className="rounded-full"
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => handleDelete(deleteConfirmItem)}
                className="rounded-full"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
