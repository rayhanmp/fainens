import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bold, Heading2, Link2, List, ListChecks, Pencil } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';
import { Segmented } from '../savings/fields';

const MAX_LENGTH = 20_000;

const TOOLS = [
  { label: 'Bold', icon: Bold },
  { label: 'Heading', icon: Heading2 },
  { label: 'List', icon: List },
  { label: 'Checklist', icon: ListChecks },
  { label: 'Link', icon: Link2 },
] as const;

/** Ticks or unticks the checklist item that starts on `line` (1-based) of the markdown. */
function toggleTask(markdown: string, line: number): string {
  const lines = markdown.split('\n');
  const index = line - 1;
  const current = lines[index];
  if (current === undefined) return markdown;
  lines[index] = /\[[xX]\]/.test(current) ? current.replace(/\[[xX]\]/, '[ ]') : current.replace('[ ]', '[x]');
  return lines.join('\n');
}

/**
 * Markdown rendered without raw HTML, with links opening in a new tab. Checklist items can be
 * ticked straight from the page when `onToggle` is given.
 */
function Rendered({ markdown, onToggle }: { markdown: string; onToggle?: (line: number) => void }) {
  return (
    <div className="agent-markdown text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
          li: ({ node, className, children }) => {
            const line = node?.position?.start.line;
            if (!className?.includes('task-list-item') || !onToggle || !line) return <li className={className}>{children}</li>;
            // The checkbox remark renders is read-only; this one ticks the item in the notes.
            const [, ...rest] = Array.isArray(children) ? children : [children];
            const checked = /\[[xX]\]/.test(markdown.split('\n')[line - 1] ?? '');
            return (
              <li className={cn(className, 'list-none')}>
                <label className="-ml-5 flex cursor-pointer items-start gap-2">
                  <input type="checkbox" checked={checked} onChange={() => onToggle(line)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--ref-primary)]" />
                  <span className={cn(checked && 'text-[var(--ref-on-surface-variant)] line-through')}>{rest}</span>
                </label>
              </li>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/**
 * A goal's notes in markdown: what it is, the plan, a checklist, links. Shown rendered; Edit opens
 * a plain editor with a few formatting buttons and a preview.
 */
export function GoalNotes({ value, busy, onSave }: { value: string | null; busy: boolean; onSave: (next: string | null) => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [view, setView] = useState<'write' | 'preview'>('write');
  const area = useRef<HTMLTextAreaElement>(null);

  const open = () => {
    setDraft(value ?? '');
    setView('write');
    setEditing(true);
  };
  const save = async () => {
    await onSave(draft.trim() ? draft : null);
    setEditing(false);
  };
  // Wraps the selection (or inserts at the cursor) and keeps the selection on the text.
  const wrap = (before: string, after = '', placeholder = '') => {
    const element = area.current;
    if (!element) return;
    const { selectionStart: start, selectionEnd: end } = element;
    const selected = draft.slice(start, end) || placeholder;
    const next = `${draft.slice(0, start)}${before}${selected}${after}${draft.slice(end)}`;
    setDraft(next.slice(0, MAX_LENGTH));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };
  // Starts the current line (or each selected line) with a prefix, like "- " or "- [ ] ".
  const prefixLines = (prefix: string) => {
    const element = area.current;
    if (!element) return;
    const lineStart = draft.lastIndexOf('\n', element.selectionStart - 1) + 1;
    const end = element.selectionEnd;
    const block = draft.slice(lineStart, end) || '';
    const prefixed = (block || '').split('\n').map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`)).join('\n');
    setDraft(`${draft.slice(0, lineStart)}${prefixed}${draft.slice(end)}`.slice(0, MAX_LENGTH));
    requestAnimationFrame(() => element.focus());
  };

  if (!editing) {
    return value ? (
      <div className="group relative">
        <Rendered markdown={value} onToggle={busy ? undefined : (line) => void onSave(toggleTask(value, line))} />
        <Button type="button" size="sm" variant="secondary" className="mt-3 h-[34px]" onClick={open}><Pencil className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Edit notes</Button>
      </div>
    ) : (
      <button type="button" onClick={open} className="w-full rounded-xl border border-dashed border-[var(--color-border)] px-4 py-5 text-left text-sm text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]">
        <span className="font-semibold text-[var(--ref-on-surface)]">Add notes</span>
        <span className="mt-0.5 block text-xs">What it’s for, the plan, a checklist, links. Markdown works: **bold**, - lists, - [ ] checklists.</span>
      </button>
    );
  }

  // Run on click only, so the editor's text box is read then, never while drawing.
  const apply = (tool: (typeof TOOLS)[number]['label']) => {
    if (tool === 'Bold') wrap('**', '**', 'bold');
    else if (tool === 'Heading') prefixLines('## ');
    else if (tool === 'List') prefixLines('- ');
    else if (tool === 'Checklist') prefixLines('- [ ] ');
    else wrap('[', '](https://)', 'link text');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="toolbar" aria-label="Formatting">
          {TOOLS.map(({ label, icon: Icon }) => (
            <button key={label} type="button" title={label} aria-label={label} disabled={view === 'preview'} onClick={() => apply(label)} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40">
              <Icon className="h-4 w-4" aria-hidden />
            </button>
          ))}
        </div>
        <Segmented ariaLabel="Notes view" className="w-[180px]" value={view} onChange={setView} options={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} />
      </div>
      {view === 'write' ? (
        <textarea
          ref={area}
          value={draft}
          maxLength={MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void save();
            if (event.key === 'Escape') setEditing(false);
          }}
          rows={10}
          className="brutalist-input min-h-[200px] w-full resize-y font-mono text-[13px] leading-relaxed"
          placeholder={'## The plan\n- [ ] Book flights\n- [ ] Apply for the visa\n\nhttps://…'}
          aria-label="Notes"
          autoFocus
        />
      ) : (
        <div className="min-h-[200px] rounded-xl border border-[var(--color-border)] px-4 py-3">{draft.trim() ? <Rendered markdown={draft} /> : <p className="text-sm text-[var(--ref-on-surface-variant)]">Nothing to preview yet.</p>}</div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--ref-on-surface-variant)]">Ctrl+Enter saves · Esc cancels</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          <Button type="button" size="sm" isLoading={busy} onClick={() => void save()}>Save notes</Button>
        </div>
      </div>
    </div>
  );
}
