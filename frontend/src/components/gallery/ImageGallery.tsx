import { useState } from 'react';
import { Image as ImageIcon, Loader2, Search, Trash2, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useConfirm } from '../ui/ConfirmDialog';
import { useDeleteGalleryImageMutation, useGalleryImagesQuery, type GalleryImage, type GallerySource } from '../../features/gallery/queries';

const SOURCE_OPTIONS: Array<{ value: GallerySource; label: string }> = [
  { value: 'all', label: 'All images' },
  { value: 'transaction', label: 'Transactions' },
  { value: 'agent', label: 'Agent' },
  { value: 'wishlist', label: 'Wishlist' },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return 'Stored image';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: number | null): string {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function sourceLabel(source: GalleryImage['source']): string {
  return source === 'transaction' ? 'Transaction' : source === 'agent' ? 'Agent' : 'Wishlist';
}

export function ImageGallery() {
  const [source, setSource] = useState<GallerySource>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GalleryImage | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useGalleryImagesQuery(source, search);
  const deleteMutation = useDeleteGalleryImageMutation();
  const { confirm } = useConfirm();
  const images = query.data ?? [];

  const removeImage = async (image: GalleryImage) => {
    setActionError(null);
    const confirmed = await confirm({
      title: 'Delete image?',
      message: image.storageManaged
        ? 'This removes the image from Fainens and queues its stored object for deletion. The linked transaction or message will remain.'
        : 'This removes the external image from the wishlist item. The original external image will not be changed.',
      confirmLabel: 'Delete image',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync({ source: image.source, id: image.id });
      if (selected?.source === image.source && selected.id === image.id) setSelected(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete image.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-[var(--color-text-secondary)]">Browse images linked to transactions, agent conversations, and wishlist items.</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">Stored previews use short-lived private URLs. Deleting one also cleans up its R2 object.</p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-[var(--color-muted)]">{query.isPending ? 'Loading…' : `${images.length} image${images.length === 1 ? '' : 's'}`}</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Image sources">
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={source === option.value}
              onClick={() => setSource(option.value)}
              className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition ${source === option.value ? 'bg-[var(--ref-primary)] text-white' : 'bg-[var(--ref-surface-container-low)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-high)]'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden="true" />
          <span className="sr-only">Search images</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search images…"
            className="brutalist-input w-full bg-[var(--ref-surface-container-low)] pl-9 pr-3 py-2 text-sm"
          />
        </label>
      </div>

      {query.isPending && !query.data ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] py-14 text-sm text-[var(--color-text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading gallery…</div>
      ) : query.isError ? (
        <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-danger)]">Could not load the image gallery. Please try again.</div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] px-6 py-14 text-center">
          <ImageIcon className="h-8 w-8 text-[var(--color-muted)]" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">No images here yet</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-muted)]">Upload a receipt or send an image to Fainens Agent and it will appear here automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <article key={`${image.source}-${image.id}`} className="group overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
              <button type="button" onClick={() => setSelected(image)} className="relative block aspect-square w-full cursor-pointer overflow-hidden bg-[var(--ref-surface-container-low)] text-left" aria-label={`Preview ${image.filename}`}>
                {image.downloadUrl ? (
                  <img src={image.downloadUrl} alt={image.filename} loading="lazy" className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[var(--color-muted)]"><ImageIcon className="h-7 w-7" aria-hidden="true" /></div>
                )}
              </button>
              <div className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-[var(--color-text-primary)]" title={image.filename}>{image.filename}</p>
                    <p className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">{sourceLabel(image.source)} · {formatDate(image.createdAt)}</p>
                  </div>
                  <button type="button" onClick={() => void removeImage(image)} disabled={deleteMutation.isPending} className="shrink-0 cursor-pointer rounded-lg p-1.5 text-[var(--color-muted)] transition hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Delete ${image.filename}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--color-muted)]"><span className="truncate">{image.context ?? image.relatedLabel ?? 'Fainens'}</span><span className="shrink-0">{formatBytes(image.fileSize)}</span></div>
              </div>
            </article>
          ))}
        </div>
      )}

      {actionError && <p role="alert" className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{actionError}</p>}

      {selected && (
        <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title={selected.filename} subtitle={`${sourceLabel(selected.source)} · ${formatDate(selected.createdAt)}`}>
          <div className="space-y-4">
            <div className="flex max-h-[60vh] items-center justify-center overflow-hidden rounded-xl bg-[var(--ref-surface-container-low)] p-2">
              {selected.downloadUrl ? <img src={selected.downloadUrl} alt={selected.filename} className="max-h-[56vh] max-w-full object-contain" /> : <ImageIcon className="h-10 w-10 text-[var(--color-muted)]" aria-hidden="true" />}
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
              <span>{selected.context ?? selected.relatedLabel ?? 'Fainens image'}</span>
              <span>{formatBytes(selected.fileSize)}</span>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)]"><X className="h-4 w-4" />Close preview</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
