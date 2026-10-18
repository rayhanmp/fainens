import { useEffect, useState } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import { ComboBox, type PickerOption } from './EntryPickers';
import { useCreateTagMutation } from '../../features/categories/queries';
import { useTransactionTagSuggestions } from '../../features/transactions/queries';

export type TagRow = {
  id: number;
  name: string;
  color: string;
  usageCount?: number;
};

type TagPickerProps = {
  id?: string;
  tags: TagRow[];
  selectedTagIds: number[];
  onChange: (tagIds: number[]) => void;
  suggestionContext?: { description: string; notes?: string; place?: string; categoryId?: number; transactionId?: number };
};

/**
 * Tags behave like the other dropdown fields: the field opens a searchable A–Z list where several
 * tags can be ticked, and a name that matches nothing can be added on the spot. Chosen tags sit
 * under the field as chips for one-tap removal, and AI suggestions appear there too.
 */
export function TagPicker({ id, tags, selectedTagIds, onChange, suggestionContext }: TagPickerProps) {
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
  // Suggestions are a nicety: when the request fails, the picker simply works without them.
  const aiTags = showSuggestions ? (suggestionsQuery.data?.tags ?? [])
    .flatMap(suggestion => {
      const tag = tags.find(tag => tag.id === suggestion.id);
      return tag && !selectedTagIds.includes(tag.id) ? [tag] : [];
    }) : [];
  const selectedTags = tags.filter((tag) => selectedTagIds.includes(tag.id));
  // Quick-add chips: AI suggestions first, then the most-used tags, four at most.
  const mostUsed = [...tags]
    .sort((left, right) => (right.usageCount ?? 0) - (left.usageCount ?? 0) || left.name.localeCompare(right.name))
    .filter((tag) => !selectedTagIds.includes(tag.id));
  const quickTags = [...aiTags, ...mostUsed.filter((tag) => !aiTags.some((suggested) => suggested.id === tag.id))].slice(0, 4);
  const options: PickerOption[] = [...tags]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tag) => ({
      id: String(tag.id),
      label: tag.name,
      detail: tag.usageCount ? `${tag.usageCount} use${tag.usageCount === 1 ? '' : 's'}` : undefined,
      leading: <span className="block h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} aria-hidden />,
    }));

  const toggleTag = (tagId: number) => {
    onChange(selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId]);
  };

  const createAndSelectTag = async (name: string) => {
    if (createTagMutation.isPending) return;
    const createdTag = await createTagMutation.mutateAsync({ name, color: '#64748B' });
    onChange([...selectedTagIds, createdTag.id]);
  };

  return (
    <div className="space-y-2">
      <ComboBox
        id={id}
        value=""
        selectedIds={selectedTagIds.map(String)}
        options={options}
        onChange={(tagId) => toggleTag(Number(tagId))}
        onCreate={createAndSelectTag}
        placeholder={tags.length ? 'Add tags' : 'Type to add your first tag'}
        searchPlaceholder="Search or add a tag"
      />

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              aria-label={`Remove tag ${tag.name}`}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 pl-2.5 pr-1.5 text-xs font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
            >
              {tag.name}
              <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
        </div>
      )}

      {quickTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
          {quickTags.map(tag => {
            const suggested = aiTags.some((candidate) => candidate.id === tag.id);
            return (
              <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)} title={suggested ? 'Suggested for this transaction' : 'Often used'} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--color-border-strong)] pl-2 pr-2.5 text-xs font-semibold text-[var(--ref-on-surface-variant)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                {suggested ? <Sparkles className="h-3 w-3 text-[var(--color-accent)]" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}{tag.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
