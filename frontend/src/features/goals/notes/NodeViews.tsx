import { useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { CalendarDays, Check, ExternalLink, FileText, Link2, Receipt, Ticket } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { goalLinkImageUrl } from '../queries';
import { useNotesContext } from './context';
import { fromIsoDate } from './notes-utils';

const KIND_ICONS = { part: Receipt, booking: Ticket, file: FileText } as const;

/** A `[[` link to a part, booking or file of the goal, showing how it stands right now. */
export function GoalRefView({ node, selected }: NodeViewProps) {
  const { targets } = useNotesContext();
  const kind = node.attrs.kind as keyof typeof KIND_ICONS;
  const id = Number(node.attrs.id);
  const target = targets.find((item) => item.kind === kind && item.id === id);
  const Icon = KIND_ICONS[kind] ?? Link2;
  const body = (
    <>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className={cn(target?.done && 'line-through')}>{target?.label ?? node.attrs.label}</span>
      {target?.detail && <span className="font-normal opacity-75">· {target.detail}</span>}
      {target?.done && <Check className="h-3 w-3 shrink-0 text-[var(--color-success)]" aria-hidden />}
      {!target && <span className="font-normal opacity-70">· removed</span>}
    </>
  );
  const chip = cn('mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-px align-baseline text-[0.85em] font-semibold', target ? 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface-variant)]', selected && 'ring-2 ring-[var(--ref-primary)]/50');
  return (
    <NodeViewWrapper as="span" className="inline">
      {target?.href ? <a href={target.href} target="_blank" rel="noreferrer" className={chip} contentEditable={false}>{body}</a> : <span className={chip} contentEditable={false}>{body}</span>}
    </NodeViewWrapper>
  );
}

/** An `@` date: a chip that reads "14 Mar 2027", red once it's past; click it to change the day. */
export function DateChipView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const date = fromIsoDate(String(node.attrs.date));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const past = date !== null && date < today;
  const label = date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) : 'No date';
  return (
    <NodeViewWrapper as="span" className="relative inline">
      <button
        type="button"
        contentEditable={false}
        onClick={() => editor.isEditable && setEditing((open) => !open)}
        className={cn('mx-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-px align-baseline text-[0.85em] font-semibold', past ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300', selected && 'ring-2 ring-[var(--ref-primary)]/50')}
      >
        <CalendarDays className="h-3 w-3" aria-hidden />{label}
      </button>
      {editing && (
        <span contentEditable={false} className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1.5 shadow-lg">
          <input
            type="date"
            autoFocus
            defaultValue={String(node.attrs.date)}
            aria-label="Date"
            className="brutalist-input h-[30px] text-xs"
            onChange={(event) => { if (event.target.value) updateAttributes({ date: event.target.value }); }}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') setEditing(false); }}
          />
        </span>
      )}
    </NodeViewWrapper>
  );
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** A link shown as a card: its picture and title when the shop could be read, and where it goes. */
export function LinkCardView({ node, selected }: NodeViewProps) {
  const href = String(node.attrs.href ?? '');
  const title = String(node.attrs.title || host(href));
  const image = node.attrs.image ? String(node.attrs.image) : null;
  return (
    <NodeViewWrapper className="my-2" data-drag-handle="">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        contentEditable={false}
        className={cn('flex max-w-md items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 no-underline transition-colors hover:bg-[var(--ref-surface-container-low)]', selected && 'ring-2 ring-[var(--ref-primary)]/50')}
      >
        {image
          ? <img src={goalLinkImageUrl(image)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
          : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)]"><Link2 className="h-5 w-5" aria-hidden /></span>}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-semibold text-[var(--ref-on-surface)]">{title}</span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ref-on-surface-variant)]">{host(href)}<ExternalLink className="h-3 w-3" aria-hidden /></span>
        </span>
      </a>
    </NodeViewWrapper>
  );
}

const SIZES = [{ value: 'small', label: 'S' }, { value: 'medium', label: 'M' }, { value: 'full', label: 'L' }] as const;

/** A picture in the notes, at one of three widths you can switch while it's selected. */
export function SizedImageView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const size = (node.attrs.size as string) || 'full';
  return (
    <NodeViewWrapper className={cn('relative my-2', size === 'small' ? 'w-1/3 min-w-[140px]' : size === 'medium' ? 'w-2/3' : 'w-full')} data-drag-handle="">
      <img src={String(node.attrs.src)} alt={String(node.attrs.alt ?? '')} className={cn('block w-full rounded-xl', selected && 'ring-2 ring-[var(--ref-primary)]')} loading="lazy" />
      {selected && editor.isEditable && (
        <span contentEditable={false} className="absolute right-2 top-2 flex gap-0.5 rounded-lg bg-[#0b1b3a]/70 p-0.5 backdrop-blur">
          {SIZES.map((item) => (
            <button key={item.value} type="button" aria-label={`${item.value} size`} aria-pressed={size === item.value} onClick={() => updateAttributes({ size: item.value })} className={cn('grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold text-white', size === item.value ? 'bg-[#fff]/30' : 'hover:bg-[#fff]/15')}>{item.label}</button>
          ))}
        </span>
      )}
    </NodeViewWrapper>
  );
}
