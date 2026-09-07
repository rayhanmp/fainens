import { useMemo, useState } from 'react';
import { Image as ImageIcon, Loader2, Search } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useGalleryImagesQuery, type GalleryImage, type GallerySource } from '../../features/gallery/queries';

const AGENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SOURCE_OPTIONS: Array<{ value: GallerySource; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'transaction', label: 'Transactions' },
  { value: 'agent', label: 'Agent' },
  { value: 'wishlist', label: 'Wishlist' },
];

type GalleryImagePickerProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (image: GalleryImage) => Promise<void>;
  disabled?: boolean;
};

function sourceLabel(source: GalleryImage['source']): string {
  return source === 'transaction' ? 'Transaction' : source === 'agent' ? 'Agent' : 'Wishlist';
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return 'Stored image';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GalleryImagePicker({ isOpen, onClose, onSelect, disabled = false }: GalleryImagePickerProps) {
  const [source, setSource] = useState<GallerySource>('all');
  const [search, setSearch] = useState('');
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const query = useGalleryImagesQuery(source, search, isOpen);
  const images = useMemo(
    () => (query.data ?? []).filter((image) => image.storageManaged && AGENT_IMAGE_TYPES.has(image.mimetype.toLowerCase())),
    [query.data],
  );

  const selectImage = async (image: GalleryImage) => {
    if (disabled || selectingKey != null) return;
    const key = `${image.source}:${image.id}`;
    setSelectingKey(key);
    try {
      await onSelect(image);
    } finally {
      setSelectingKey(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Choose from gallery"
      subtitle="Select a stored JPEG, PNG, WebP, or GIF to attach to this message."
      size="xl"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Gallery image sources">
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
          <label className="relative block sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden="true" />
            <span className="sr-only">Search gallery</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search gallery…"
              className="brutalist-input w-full bg-[var(--ref-surface-container-low)] py-2 pl-9 pr-3 text-sm"
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
            <p className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">No attachable images found</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-muted)]">Upload an image or send one to Fainens Agent first. External wishlist images are preview-only.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image) => {
              const key = `${image.source}:${image.id}`;
              const isSelecting = selectingKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void selectImage(image)}
                  disabled={disabled || selectingKey != null}
                  className="group overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-left transition hover:-translate-y-0.5 hover:border-[var(--ref-primary)] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Attach ${image.filename}`}
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-[var(--ref-surface-container-low)]">
                    {image.downloadUrl ? <img src={image.downloadUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-[var(--color-muted)]"><ImageIcon className="h-7 w-7" aria-hidden="true" /></div>}
                    {isSelecting && <div className="absolute inset-0 flex items-center justify-center bg-black/35 text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>}
                  </div>
                  <div className="space-y-1 p-2.5">
                    <p className="truncate text-xs font-bold text-[var(--color-text-primary)]" title={image.filename}>{image.filename}</p>
                    <p className="truncate text-[10px] text-[var(--color-muted)]">{sourceLabel(image.source)} · {formatBytes(image.fileSize)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
