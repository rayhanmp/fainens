import { useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { useCreateTagMutation } from '../../features/categories/queries';

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
};

export function TagPicker({ tags, selectedTagIds, onChange }: TagPickerProps) {
  const [search, setSearch] = useState('');
  const createTagMutation = useCreateTagMutation();
  const normalizedSearch = search.trim().toLowerCase();
  const selectedTags = tags.filter((tag) => selectedTagIds.includes(tag.id));
  const suggestedTags = [...tags]
    .sort((left, right) => (right.usageCount ?? 0) - (left.usageCount ?? 0) || left.name.localeCompare(right.name))
    .slice(0, 6);
  const visibleTags = (normalizedSearch
    ? tags.filter((tag) => tag.name.toLowerCase().includes(normalizedSearch))
    : suggestedTags
  ).filter((tag) => !selectedTagIds.includes(tag.id));
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
