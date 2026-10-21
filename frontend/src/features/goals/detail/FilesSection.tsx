import { useRef, useState } from 'react';
import { FileText, ImageIcon, Star, Trash2, Upload } from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { toast } from '../../../components/ui/useToast';
import { cn } from '../../../lib/utils';
import { InfoHint } from '../../savings/InfoHint';
import { Section } from '../../subscriptions/PageParts';
import { GOAL_FILE_TYPES, goalFileUrl, useDeleteGoalFileMutation, useUpdateGoalFileMutation, useUploadGoalFileMutation, type GoalDetail } from '../queries';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * The goal's files: quotes, brochures, bookings, photos. Drop them in or pick them; pictures show as
 * thumbnails and one can be the goal's cover. Each opens in a new tab.
 */
export function FilesSection({ detail }: { detail: GoalDetail }) {
  const { confirm } = useConfirm();
  const upload = useUploadGoalFileMutation();
  const update = useUpdateGoalFileMutation();
  const remove = useDeleteGoalFileMutation();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const { goal, attachments } = detail;

  const send = async (files: FileList | File[]) => {
    const list = Array.from(files);
    setUploading((count) => count + list.length);
    for (const file of list) {
      try {
        await upload.mutateAsync({ id: goal.id, file });
      } catch (error) {
        toast.error(`${file.name}: ${errorText(error, 'Could not upload')}`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  return (
    <Section
      title="Files"
      aside={(
        <div className="flex items-center gap-2">
          <InfoHint label="About files" align="right">Pictures, PDFs and text files up to 5 MB each, like a quote, a brochure or a booking. A picture can be the goal’s cover.</InfoHint>
          <button type="button" onClick={() => input.current?.click()} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold hover:bg-[var(--ref-surface-container-low)]"><Upload className="h-3.5 w-3.5" aria-hidden />Add files</button>
          <input ref={input} type="file" multiple accept={GOAL_FILE_TYPES.join(',')} className="hidden" onChange={(event) => { if (event.target.files?.length) void send(event.target.files); event.target.value = ''; }} />
        </div>
      )}
    >
      <div
        className={cn('px-4 py-4 sm:px-5', dragging && 'bg-[var(--ref-primary)]/5')}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void send(event.dataTransfer.files); }}
      >
        {attachments.length === 0 && uploading === 0 ? (
          <button type="button" onClick={() => input.current?.click()} className={cn('w-full rounded-xl border border-dashed px-4 py-6 text-center text-sm text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]', dragging ? 'border-[var(--ref-primary)]' : 'border-[var(--color-border)]')}>
            <ImageIcon className="mx-auto mb-1.5 h-5 w-5" aria-hidden />
            Drop a quote, brochure, booking or photo here
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {attachments.map((file) => {
              const picture = file.mimetype.startsWith('image/');
              return (
                <li key={file.id} className="group relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)]">
                  <a href={goalFileUrl(file.id)} target="_blank" rel="noreferrer" className="block">
                    {picture ? (
                      <img src={goalFileUrl(file.id)} alt={file.filename} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    ) : (
                      <span className="grid aspect-[4/3] w-full place-items-center text-[var(--ref-on-surface-variant)]"><FileText className="h-8 w-8" aria-hidden /></span>
                    )}
                    <span className="block border-t border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5">
                      <span className="block truncate text-xs font-medium text-[var(--ref-on-surface)]">{file.filename}</span>
                      <span className="block text-[11px] text-[var(--ref-on-surface-variant)]">{size(file.fileSize)}{file.isCover ? ' · Cover' : ''}</span>
                    </span>
                  </a>
                  <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    {picture && (
                      <button
                        type="button"
                        aria-label={file.isCover ? 'Cover picture' : 'Use as cover'}
                        title={file.isCover ? 'Cover picture' : 'Use as cover'}
                        onClick={() => update.mutate({ id: file.id, isCover: !file.isCover }, { onError: (error) => toast.error(errorText(error, 'Could not save')) })}
                        className={cn('grid h-7 w-7 place-items-center rounded-md bg-[#0b1b3a]/60 text-white backdrop-blur hover:bg-[#0b1b3a]/80', file.isCover && 'text-amber-300')}
                      >
                        <Star className={cn('h-3.5 w-3.5', file.isCover && 'fill-current')} aria-hidden />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${file.filename}`}
                      onClick={async () => {
                        if (!(await confirm({ title: `Remove ${file.filename}?`, message: 'The file is deleted.', confirmLabel: 'Remove', variant: 'danger' }))) return;
                        remove.mutate(file.id, { onError: (error) => toast.error(errorText(error, 'Could not remove')) });
                      }}
                      className="grid h-7 w-7 place-items-center rounded-md bg-[#0b1b3a]/60 text-white backdrop-blur hover:bg-[#0b1b3a]/80"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  {/* A cover that's still the goal's: a star in the corner, always shown. */}
                  {file.isCover && <Star className="absolute left-2 top-2 h-4 w-4 fill-amber-300 text-amber-300 drop-shadow" aria-hidden />}
                </li>
              );
            })}
            {Array.from({ length: uploading }, (_, index) => <li key={`uploading-${index}`} className="aspect-[4/3] animate-pulse rounded-xl bg-[var(--ref-surface-container-high)]" aria-label="Uploading" />)}
          </ul>
        )}
      </div>
    </Section>
  );
}
