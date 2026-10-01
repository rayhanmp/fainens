import { useEffect, useState } from 'react';
import { Plus, Search, Sparkles, X } from 'lucide-react';
import { useCreateTagMutation } from '../../features/categories/queries';
import { useTransactionTagSuggestions } from '../../features/transactions/queries';

export type TagRow = {
  id: number;
  name: string;
  color: string;
  usageCount?: number;
};

type TagPickerProps = {
  tags: TagRow[];
  selectedTagIds: number[];
  onChange: (tagIds: number[]) => void;
  suggestionContext?: { description: string; notes?: string; place?: string; categoryId?: number; transactionId?: number };
};

export function TagPicker({ tags, selectedTagIds, onChange, suggestionContext }: TagPickerProps) {
  const [search, setSearch] = useState('');
  const [readyContext, setReadyContext] = useState<string | null>(null);
  const createTagMutation = useCreateTagMutation();
  const context = suggestionContext ? {
    description: suggestionContext.description.trim(),
    notes: suggestionContext.notes?.trim() || undefined,
    place: suggestionContext.place?.trim() || undefined,
    categoryId: suggestionContext.categoryId,
    transactionId: suggestionContext.transactionId,
  } : undefined;
  const requestKey = JSON.stringify([context, tags.map(tag => [tag.id, tag.name])]);
  const canSuggest = context != null && context.description.length >= 2 && tags.length > 0;
  useEffect(() => {
    if (!canSuggest) return;
    const timer = window.setTimeout(() => setReadyContext(requestKey), 800);
    return () => window.clearTimeout(timer);
  }, [requestKey, canSuggest]);
  const showSuggestions = canSuggest && readyContext === requestKey;
  const suggestionsQuery = useTransactionTagSuggestions(context, requestKey, showSuggestions);
  const aiTags = showSuggestions ? (suggestionsQuery.data?.tags ?? [])
    .flatMap(suggestion => {
      const tag = tags.find(tag => tag.id === suggestion.id);
      return tag && !selectedTagIds.includes(tag.id) ? [tag] : [];
    }) : [];
  const normalizedSearch = search.trim().toLowerCase();
  const selectedTags = tags.filter((tag) => selectedTagIds.includes(tag.id));
  const suggestedTags = [...tags]
    .sort((left, right) => (right.usageCount ?? 0) - (left.usageCount ?? 0) || left.name.localeCompare(right.name))
    .slice(0, 6);
  const visibleTags = (normalizedSearch
    ? tags.filter((tag) => tag.name.toLowerCase().includes(normalizedSearch))
    : suggestedTags
  ).filter((tag) => !selectedTagIds.includes(tag.id) && (normalizedSearch || !aiTags.some(suggestion => suggestion.id === tag.id)));
  const tagAlreadyExists = tags.some((tag) => tag.name.trim().toLowerCase() === normalizedSearch);

  const toggleTag = (tagId: number) => {
    onChange(selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId]);
  };

  const createAndSelectTag = async () => {
    const name = search.trim();
    if (!name || tagAlreadyExists || createTagMutation.isPending) return;
    const createdTag = await createTagMutation.mutateAsync({ name, color: '#64748B' });
    onChange([...selectedTagIds, createdTag.id]);
    setSearch('');
  };

  return (
    <div className="space-y-2">
      {suggestionContext && tags.length > 0 && (
        <div className="space-y-2">
          {showSuggestions && <div aria-live="polite" className="space-y-1.5">
            {suggestionsQuery.isFetching && <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]"><Sparkles className="h-3.5 w-3.5" />Suggesting tags…</p>}
            {suggestionsQuery.isError && <div className="flex flex-wrap items-center gap-2 text-xs"><p className="text-[var(--color-danger)]">{suggestionsQuery.error.message}</p><button type="button" onClick={() => void suggestionsQuery.refetch()} disabled={suggestionsQuery.isFetching} className="font-semibold text-[var(--color-accent)] disabled:opacity-50">Try again</button></div>}
            {aiTags.length > 0 && <>
              <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]"><Sparkles className="h-3.5 w-3.5" />Suggested for this transaction · tap to add</p>
              <div className="flex flex-wrap gap-1.5">
                {aiTags.map(tag => <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)} disabled={selectedTagIds.length >= 100} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-2.5 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/15 disabled:opacity-50"><Plus className="h-3 w-3" />{tag.name}</button>)}
              </div>
            </>}
            {suggestionsQuery.isSuccess && !suggestionsQuery.isFetching && aiTags.length === 0 && <p className="text-xs text-[var(--color-muted)]">{suggestionsQuery.data.tags.length ? 'All suggested tags are already selected.' : 'No matching tags found.'}</p>}
          </div>}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && normalizedSearch && !tagAlreadyExists) {
              event.preventDefault();
              void createAndSelectTag();
            }
          }}
          placeholder="Search or add a tag"
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-2 pl-9 pr-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/15"
        />
      </div>

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-accent)]"
            >
              {tag.name}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      {visibleTags.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {visibleTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/5"
            >
              <span className="block truncate">{tag.name}</span>
            </button>
          ))}
        </div>
      )}

      {normalizedSearch && !tagAlreadyExists && (
        <button
          type="button"
          onClick={() => void createAndSelectTag()}
          disabled={createTagMutation.isPending}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-[var(--color-accent)]/50 px-3 py-2 text-left text-xs font-bold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          {createTagMutation.isPending ? 'Adding tag…' : `Add “${search.trim()}”`}
        </button>
      )}

      {!normalizedSearch && visibleTags.length === 0 && selectedTags.length === 0 && (
        <p className="text-xs text-[var(--color-muted)]">No tags yet. Type above to create one.</p>
      )}
      {normalizedSearch && visibleTags.length === 0 && tagAlreadyExists && selectedTags.length === 0 && (
        <p className="text-xs text-[var(--color-muted)]">That tag is already selected.</p>
      )}
    </div>
  );
}
