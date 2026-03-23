import { useState, useEffect } from 'react';
import { 
  Plus, 
  Tag, 
  Calendar, 
  Link2, 
  Loader2, 
  AlertCircle,
  Trash2,
  CheckCircle2,
  Sparkles,
  Flag,
  ChevronDown,
  ChevronUp,
  Bot
} from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { CurrencyInput } from '../ui/CurrencyInput';
import { cn } from '../../lib/utils';

interface CreateWishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  categories: Array<{ id: number; name: string; icon: string | null; color: string | null }>;
}

interface ScrapingAttempt {
  method: string;
  success: boolean;
  timestamp: number;
  duration: number;
  error?: string;
  dataFound?: any;
}

interface ScrapedData {
  name: string;
  price: number;
  description: string;
  imageUrl: string;
  source: string;
  currency: string;
  url: string;
  originalPrice?: number;
  discountPercentage?: number;
  rating?: number;
  reviewCount?: number;
  sellerName?: string;
  brand?: string;
}

interface ScrapingError {
  code: string;
  message: string;
  suggestions: string[];
}

type Priority = 'low' | 'medium' | 'high';

export function CreateWishlistModal({ isOpen, onClose, onSuccess, categories }: CreateWishlistModalProps) {
  // URL scraping states
  const [productUrl, setProductUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [isAdvancedScraping, setIsAdvancedScraping] = useState(false);
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);
  const [scrapeError, setScrapeError] = useState<ScrapingError | null>(null);
  const [scrapingAttempts, setScrapingAttempts] = useState<ScrapingAttempt[]>([]);
  const [showAttempts, setShowAttempts] = useState(false);
  const [requiresAdvanced, setRequiresAdvanced] = useState(false);
  const [useManualEntry, setUseManualEntry] = useState(false);
  
  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [periodId, setPeriodId] = useState<string>('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [periods, setPeriods] = useState<Array<{ id: number; name: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadPeriods();
      resetForm();
    }
  }, [isOpen]);

  // Debounced scraping
  useEffect(() => {
    if (!productUrl || useManualEntry) return;
    
    const timer = setTimeout(() => {
      if (isValidUrl(productUrl)) {
        scrapeProduct(productUrl, false);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [productUrl]);

  async function loadPeriods() {
    try {
      const data = await api.periods.list();
      setPeriods(data);
    } catch (err) {
      console.error('Failed to load periods:', err);
    }
  }

  function resetForm() {
    setProductUrl('');
    setScrapedData(null);
    setScrapeError(null);
    setScrapingAttempts([]);
    setShowAttempts(false);
    setRequiresAdvanced(false);
    setUseManualEntry(false);
    setIsAdvancedScraping(false);
    setName('');
    setDescription('');
    setAmount('');
    setCategoryId('');
    setPeriodId('');
    setPriority('medium');
    setFormError(null);
  }

  function isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function scrapeProduct(url: string, useAdvanced = false) {
    try {
      if (useAdvanced) {
        setIsAdvancedScraping(true);
      } else {
        setIsScraping(true);
      }
      setScrapeError(null);
      setScrapingAttempts([]);
      setRequiresAdvanced(false);
      
      const result = await api.wishlist.scrape(url);
      
      // Store attempts for display
      if (result.attempts) {
        setScrapingAttempts(result.attempts);
      }
      
      if (result.success && result.data) {
        setScrapedData(result.data);
        setName(result.data.name);
        setDescription(result.data.description || '');
        setAmount(result.data.price.toString());
        setRequiresAdvanced(false);
      } else {
        setScrapeError(result.error || null);
        setScrapedData(null);
        setRequiresAdvanced(result.requiresAdvancedScraping || false);
      }
    } catch (err) {
      console.error('Failed to scrape product:', err);
      setScrapeError({
        code: 'unknown_error',
        message: 'Failed to fetch product information. Please try again.',
        suggestions: ['Check your internet connection', 'Try again in a few moments'],
      });
      setScrapedData(null);
      setRequiresAdvanced(false);
    } finally {
      setIsScraping(false);
      setIsAdvancedScraping(false);
    }
  }

  async function handleAdvancedScraping() {
    if (!productUrl) return;
    
    try {
      setIsAdvancedScraping(true);
      setScrapeError(null);
      setScrapingAttempts([]);
      
      const result = await api.wishlist.scrapeAdvanced(productUrl);
      
      // Store attempts for display
      if (result.attempts) {
        setScrapingAttempts(result.attempts);
      }
      
      if (result.success && result.data) {
        setScrapedData(result.data);
        setName(result.data.name);
        setDescription(result.data.description || '');
        setAmount(result.data.price.toString());
        setRequiresAdvanced(false);
      } else {
        setScrapeError(result.error || null);
        setScrapedData(null);
        setRequiresAdvanced(result.requiresAdvancedScraping || false);
      }
    } catch (err) {
      console.error('Failed to advanced scrape product:', err);
      setScrapeError({
        code: 'advanced_error',
        message: 'Advanced scraping failed. The site may have anti-bot protection.',
        suggestions: ['Try a different product URL', 'Enter product details manually'],
      });
      setScrapedData(null);
      setRequiresAdvanced(false);
    } finally {
      setIsAdvancedScraping(false);
    }
  }

  function handleClearScrapedData() {
    setScrapedData(null);
    setProductUrl('');
    setName('');
    setDescription('');
    setAmount('');
    setScrapeError(null);
    setScrapingAttempts([]);
    setShowAttempts(false);
    setRequiresAdvanced(false);
  }

  function handleSwitchToManual() {
    setUseManualEntry(true);
    setScrapedData(null);
    setScrapeError(null);
    setProductUrl('');
    setScrapingAttempts([]);
    setShowAttempts(false);
    setRequiresAdvanced(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    
    if (!name.trim()) {
      setFormError('Please enter an item name');
      return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
      setFormError('Please enter a valid amount');
      return;
    }

    try {
      setIsSubmitting(true);
      await api.wishlist.create({
        name: name.trim(),
        description: description.trim() || null,
        amount: Math.round(parseFloat(amount)),
        categoryId: categoryId ? parseInt(categoryId) : null,
        periodId: periodId ? parseInt(periodId) : null,
        imageUrl: scrapedData?.imageUrl || null,
      });
      
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to create wishlist item:', err);
      setFormError('Failed to create wishlist item. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const priorityOptions: { value: Priority; label: string; icon: React.ReactNode; color: string }[] = [
    { value: 'low', label: 'Low', icon: <Flag className="w-3.5 h-3.5" />, color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { value: 'medium', label: 'Medium', icon: <Flag className="w-3.5 h-3.5" />, color: 'text-amber-600 bg-amber-50 border-amber-200' },
    { value: 'high', label: 'High', icon: <Flag className="w-3.5 h-3.5" />, color: 'text-red-600 bg-red-50 border-red-200' },
  ];

  // Get status icon for extraction attempt
  const getAttemptStatusIcon = (attempt: ScrapingAttempt) => {
    if (attempt.success) return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    return <AlertCircle className="w-4 h-4 text-red-400" />;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add to Wishlist"
      subtitle="Create a wishlist item to track your savings goals."
      size="xl"
      footer={
        <div className="flex flex-col gap-3 w-full">
          {formError && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-danger)] bg-[var(--color-danger)]/10 px-4 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {formError}
            </div>
          )}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1 rounded-full"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              className="flex-1 rounded-full"
              disabled={isSubmitting || !name.trim() || !amount}
            >
              {isSubmitting ? (
                <span className="animate-pulse">Saving...</span>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add to Wishlist
                </>
              )}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* URL Input Section */}
        {!useManualEntry && (
          <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-4">
            <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2 flex items-center gap-2">
              <Link2 className="w-4 h-4" />
              Product URL
              <span className="text-[var(--color-muted)] font-normal text-xs">(Optional)</span>
            </label>
            <div className="relative">
              <input
                type="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://www.tokopedia.com/..."
                className="w-full bg-[var(--ref-surface-container-lowest)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] pr-10"
                disabled={isScraping || isAdvancedScraping}
              />
              {(isScraping || isAdvancedScraping) && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
                </div>
              )}
            </div>
            <p className="text-xs text-[var(--color-muted)] mt-2">
              Paste a product URL from Tokopedia, Shopee, or other supported sites to auto-fill details
            </p>
          </div>
        )}

        {/* Scraped Data Preview */}
        {scrapedData && (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Successfully scraped from {scrapedData.source}
              </span>
              <button
                type="button"
                onClick={handleClearScrapedData}
                className="cursor-pointer text-xs text-[var(--color-muted)] hover:text-[var(--color-text-secondary)] flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>
            
            {/* Product Image */}
            <div className="flex justify-center">
              {scrapedData.imageUrl ? (
                <div className="relative">
                  <img 
                    src={`/api/wishlist-images/${scrapedData.imageUrl}`}
                    alt={scrapedData.name}
                    className="max-h-48 object-contain rounded-lg shadow-md border border-[var(--color-border)]"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 bg-[var(--ref-surface-container-high)] rounded-lg gap-3 w-full">
                  <div className="w-16 h-16 rounded-full bg-[var(--ref-surface-container)] flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-[var(--color-muted)]" />
                  </div>
                  <span className="text-sm text-[var(--color-muted)]">No product image available</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />
              Product information has been automatically filled. You can edit it below.
            </div>
          </div>
        )}

        {/* Scrape Error with Enhanced Display */}
        {scrapeError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
                  Could not fetch product info
                </h4>
                <p className="text-sm text-red-600 dark:text-red-400">
                  {scrapeError.message}
                </p>
              </div>
            </div>
            
            {/* Suggestions */}
            {scrapeError.suggestions && scrapeError.suggestions.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
                  Suggestions:
                </p>
                <ul className="space-y-1.5">
                  {scrapeError.suggestions.map((suggestion, index) => (
                    <li key={index} className="text-sm text-[var(--color-text-secondary)] flex items-start gap-2">
                      <span className="text-[var(--color-accent)] mt-1">•</span>
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Extraction Attempts */}
            {scrapingAttempts.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAttempts(!showAttempts)}
                  className="cursor-pointer w-full flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    Extraction Attempts ({scrapingAttempts.length})
                  </span>
                  {showAttempts ? (
                    <ChevronUp className="w-4 h-4 text-[var(--color-muted)]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" />
                  )}
                </button>
                
                {showAttempts && (
                  <div className="px-3 pb-3 space-y-2 border-t border-slate-200 dark:border-slate-700 pt-2">
                    {scrapingAttempts.map((attempt, index) => (
                      <div
                        key={index}
                        className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-900 rounded-lg"
                      >
                        {getAttemptStatusIcon(attempt)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-[var(--color-text-primary)]">
                              {attempt.method}
                            </span>
                            <span className="text-xs text-[var(--color-muted)]">
                              {attempt.duration}ms
                            </span>
                          </div>
                          {attempt.error && (
                            <p className="text-xs text-red-500 mt-0.5 truncate">
                              {attempt.error}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Action Buttons */}
            <div className="flex flex-col gap-2 pt-2">
              {requiresAdvanced && (
                <Button
                  type="button"
                  onClick={handleAdvancedScraping}
                  disabled={isAdvancedScraping}
                  className="w-full rounded-full bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {isAdvancedScraping ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Using Advanced Scraping...
                    </>
                  ) : (
                    <>
                      <Bot className="w-4 h-4 mr-2" />
                      Try Advanced Scraping
                    </>
                  )}
                </Button>
              )}
              <button
                type="button"
                onClick={handleSwitchToManual}
                className="cursor-pointer text-sm font-medium text-[var(--color-accent)] hover:underline text-center py-2"
              >
                Enter manually instead →
              </button>
            </div>
          </div>
        )}

        {/* Manual Entry Toggle */}
        {!useManualEntry && !scrapedData && !scrapeError && (
          <div className="text-center py-2">
            <button
              type="button"
              onClick={handleSwitchToManual}
              className="cursor-pointer text-sm text-[var(--color-accent)] hover:underline"
            >
              Or enter details manually
            </button>
          </div>
        )}

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column - Main Info */}
          <div className="lg:col-span-8 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                Item Name <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., iPhone 16 Pro, Bali Trip"
                className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-4 py-3 text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
                required
              />
            </div>

            {/* Amount */}
            <CurrencyInput
              label="Target Amount"
              value={amount}
              onChange={setAmount}
              placeholder="0"
              size="lg"
              required
            />

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., 256GB, Titanium Black, or any additional details..."
                rows={3}
                className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-4 py-3 text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-accent)]/20 resize-none"
              />
            </div>

            {/* Category Selection - Card Style */}
            <div>
              <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Category
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(categoryId === String(cat.id) ? '' : String(cat.id))}
                    className={cn(
                      'cursor-pointer px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left',
                      categoryId === String(cat.id)
                        ? 'bg-[var(--color-accent)] text-white shadow-sm'
                        : 'bg-[var(--ref-surface-container-low)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-high)]'
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Advanced Options */}
          <div className="lg:col-span-4 space-y-5">
            {/* Priority Selection */}
            <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-4">
              <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Priority
              </label>
              <div className="space-y-2">
                {priorityOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    className={cn(
                      'cursor-pointer w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                      priority === opt.value
                        ? opt.color
                        : 'bg-[var(--ref-surface-container-lowest)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-high)]'
                    )}
                  >
                    {opt.icon}
                    {opt.label}
                    {priority === opt.value && (
                      <CheckCircle2 className="w-4 h-4 ml-auto" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Period Selection */}
            <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-4">
              <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Target Period
                <span className="text-[var(--color-muted)] font-normal text-xs">(Optional)</span>
              </label>
              <select
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                className="w-full bg-[var(--ref-surface-container-lowest)] border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--color-text-primary)] cursor-pointer"
              >
                <option value="">No specific period</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--color-muted)] mt-2">
                Assign to a period to track savings progress
              </p>
            </div>

            {/* Tips Box */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Pro Tip
              </h4>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Paste a product URL to automatically fill in details like name, price, and image!
              </p>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
