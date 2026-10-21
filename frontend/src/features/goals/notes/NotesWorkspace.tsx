import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { Check, Copy, Download, History, ListTree, Maximize2, Minimize2, MoreHorizontal, Plus, Printer, Search, X } from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { queryKeys } from '../../core/query-keys';
import { GOAL_TYPES, isGoalTypeKey } from '../goal-types';
import { goalFileUrl, type GoalDetail } from '../queries';
import { NotesContext, type NoteTarget } from './context';
import { HistoryDialog } from './HistoryDialog';
import { downloadMarkdown, printNotes } from './notes-export';
import { readableMarkdown } from './notes-utils';
import { wallLabel } from '../trip/trip-utils';
import { NotesEditor, type SaveStatus } from './NotesEditor';
import {
  useAddPageMutation,
  useDeletePageMutation,
  useGoalPagesQuery,
  useNotesSearchQuery,
  useRenamePageMutation,
  useReorderPagesMutation,
  useRestoreVersionMutation,
  useSavePageMutation,
  type NotePage,
} from './queries';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const iconButton = 'grid h-[30px] w-[30px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] aria-pressed:bg-[var(--ref-primary)]/10 aria-pressed:text-[var(--ref-primary)]';
const countIn = (text: string, query: string) => {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return 0;
  let count = 0;
  const haystack = text.toLowerCase();
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
};

type Heading = { level: number; text: string; pos: number };
const NO_BOOKINGS: [] = [];

/** A small menu anchored under a button, closed by a click outside or Escape. */
function Menu({ open, onClose, children, align = 'left' }: { open: boolean; onClose: () => void; children: React.ReactNode; align?: 'left' | 'right' }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={box} role="menu" className={cn('absolute top-full z-40 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>{children}</div>;
}

function MenuItem({ onClick, children, danger, disabled }: { onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cn('flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40', danger ? 'text-[var(--color-danger)]' : 'text-[var(--ref-on-surface)]')}>{children}</button>;
}

/**
 * A goal's notes: pages as tabs (add one from the goal type's templates, rename, move or delete
 * it), each written in place. The header counts the page's checklist and says when it's saved;
 * tools search all pages (and other goals' notes), show an outline, bring back an earlier copy,
 * export the page, and widen it to a full-screen focus mode.
 */
export function NotesWorkspace({ detail, bookings = NO_BOOKINGS }: {
  detail: GoalDetail;
  /** A holiday's bookings, which notes can link to as well. */
  bookings?: ReadonlyArray<{ id: number; title: string; startAt: number | null; rupiah: number; paidAt: number | null }>;
}) {
  const { goal } = detail;
  const goalId = goal.id;
  const { confirm } = useConfirm();
  const { formatAmount } = useBalanceVisibility();
  const queryClient = useQueryClient();
  const pagesQuery = useGoalPagesQuery(goalId);
  const addPage = useAddPageMutation(goalId);
  const savePage = useSavePageMutation(goalId);
  const renamePage = useRenamePageMutation(goalId);
  const deletePage = useDeletePageMutation(goalId);
  const reorder = useReorderPagesMutation(goalId);
  const restore = useRestoreVersionMutation(goalId);
  const pages = useMemo(() => pagesQuery.data ?? [], [pagesQuery.data]);
  const [activeId, setActiveId] = useState<number | null>(null);
  // The editor is remounted only when you switch pages or restore a copy, never while typing.
  const [editorKey, setEditorKey] = useState('first');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [counts, setCounts] = useState({ done: 0, total: 0 });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [outline, setOutline] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState(false);
  const [focus, setFocus] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null);
  const [menu, setMenu] = useState<'add' | 'page' | 'export' | null>(null);
  const creating = useRef<Promise<NotePage> | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  const active = pages.find((page) => page.id === activeId) ?? pages[0] ?? null;
  const type = isGoalTypeKey(goal.goalType) ? GOAL_TYPES[goal.goalType] : null;
  const otherGoals = useNotesSearchQuery(searching ? query : '');

  const targets = useMemo<NoteTarget[]>(() => [
    ...detail.parts.map((part) => ({ kind: 'part' as const, id: part.id, label: part.name, detail: `${formatAmount(part.amount)}${part.paidAt ? ' · paid' : ''}`, done: part.paidAt !== null })),
    ...bookings.map((booking) => ({
      kind: 'booking' as const,
      id: booking.id,
      label: booking.title,
      detail: [booking.startAt !== null ? wallLabel(booking.startAt) : null, booking.rupiah ? formatAmount(booking.rupiah) : null, booking.paidAt ? 'paid' : null].filter(Boolean).join(' · '),
      done: booking.paidAt !== null,
    })),
    ...detail.attachments.map((file) => ({ kind: 'file' as const, id: file.id, label: file.filename, href: goalFileUrl(file.id) })),
  ], [detail.parts, detail.attachments, bookings, formatAmount]);

  // The outline follows the page's headings as it changes.
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const found: Heading[] = [];
      editor.state.doc.forEach((node, offset) => { if (node.type.name === 'heading') found.push({ level: Number(node.attrs.level), text: node.textContent, pos: offset }); });
      setHeadings(found);
    };
    read();
    editor.on('update', read);
    return () => { editor.off('update', read); };
  }, [editor]);

  // Focus mode leaves with Escape.
  useEffect(() => {
    if (!focus) return;
    const leave = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) setFocus(false); };
    document.addEventListener('keydown', leave);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', leave);
      document.body.style.overflow = overflow;
    };
  }, [focus]);

  const switchTo = (page: NotePage) => {
    setActiveId(page.id);
    setEditorKey(String(page.id));
    setMenu(null);
  };

  const save = useCallback(async (markdown: string) => {
    if (active) {
      await savePage.mutateAsync({ id: active.id, content: markdown });
      return;
    }
    // The first words on a goal without pages make its first page; saves meanwhile wait for it.
    if (!creating.current) creating.current = addPage.mutateAsync({ title: 'Notes', content: markdown });
    const created = await creating.current;
    setActiveId(created.id);
    if (created.content !== markdown) await savePage.mutateAsync({ id: created.id, content: markdown });
  }, [active, addPage, savePage]);

  const addFrom = async (title: string, content = '') => {
    setMenu(null);
    try {
      const created = await addPage.mutateAsync({ title: pages.some((page) => page.title === title) ? `${title} ${pages.length + 1}` : title, content });
      switchTo(created);
    } catch (error) {
      toast.error(errorText(error, 'Could not add the page'));
    }
  };

  const move = (step: -1 | 1) => {
    if (!active) return;
    const ids = pages.map((page) => page.id);
    const at = ids.indexOf(active.id);
    const to = at + step;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    reorder.mutate(ids, { onError: (error) => toast.error(errorText(error, 'Could not move the page')) });
    setMenu(null);
  };

  const remove = async () => {
    setMenu(null);
    if (!active) return;
    if (!(await confirm({ title: `Delete ${active.title}?`, message: 'The page and its earlier copies are removed.', confirmLabel: 'Delete', variant: 'danger' }))) return;
    try {
      await deletePage.mutateAsync(active.id);
      const next = pages.find((page) => page.id !== active.id);
      setActiveId(next?.id ?? null);
      setEditorKey(next ? String(next.id) : `new-${Date.now()}`);
    } catch (error) {
      toast.error(errorText(error, 'Could not delete the page'));
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    setRenaming(null);
    if (!title) return;
    renamePage.mutate({ id: renaming.id, title }, { onError: (error) => toast.error(errorText(error, 'Could not rename the page')) });
  };

  const restoreCopy = async (versionId: number) => {
    try {
      const page = await restore.mutateAsync(versionId);
      queryClient.setQueryData<NotePage[]>(queryKeys.goals.pages(goalId), (list) => list?.map((item) => (item.id === page.id ? page : item)));
      setHistory(false);
      setEditorKey(`${page.id}-${Date.now()}`);
      toast.success('Restored. The text before is kept in the history.');
    } catch (error) {
      toast.error(errorText(error, 'Could not restore it'));
    }
  };

  const jumpTo = (heading: Heading) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(heading.pos + 1).run();
    const dom = editor.view.nodeDOM(heading.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const markdownNow = () => (editor ? (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown() : active?.content ?? '');
  const pageTitle = active?.title ?? 'Notes';
  const starters = [
    ...(type ? [{ label: `Start from the ${type.label.toLowerCase()} notes`, markdown: type.notes }] : []),
    { label: 'Start from an outline', markdown: '## Why\n\n\n\n## The plan\n\n- [ ] \n\n## Links\n\n' },
  ];
  const templates = (type?.pages ?? []).filter((template) => !pages.some((page) => page.title === template.title));
  const matchesHere = searching && editor ? countIn(editor.state.doc.textContent, query) : 0;
  const matchesElsewhere = searching ? pages.filter((page) => page.id !== active?.id).map((page) => ({ page, count: countIn(readableMarkdown(page.content) + ' ' + page.title, query) })).filter((item) => item.count > 0) : [];
  const fromOtherGoals = (otherGoals.data ?? []).filter((hit) => hit.goalId !== goalId);

  const saved = status === 'saving' ? 'Saving…' : status === 'saved' ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" aria-hidden />Saved</span> : status === 'error' ? <span className="text-[var(--color-danger)]">Not saved; keep typing to retry</span> : null;

  return (
    <NotesContext.Provider value={{ goalId, targets, formatAmount }}>
      <section
        aria-label="Notes"
        className={cn(
          'rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]',
          focus && 'fixed inset-0 z-[70] overflow-y-auto rounded-none border-0',
        )}
      >
        <div className={cn(focus && 'mx-auto max-w-3xl px-4 py-6 sm:py-10')}>
          {/* The header: name, checklist count, save state and tools. */}
          <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3 sm:px-5', !focus && 'border-b border-[var(--color-border)] pb-0')}>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">{focus ? `${goal.icon ?? ''} ${goal.name} · ${pageTitle}` : 'Notes'}</h2>
              {counts.total > 0 && <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{counts.done} of {counts.total} done</span>}
              <span className="text-[11px] text-[var(--ref-on-surface-variant)]" aria-live="polite">{saved}</span>
            </div>
            <div className="relative flex items-center gap-0.5">
              <button type="button" className={iconButton} aria-label="Search the notes" aria-pressed={searching} title="Search" onClick={() => { setSearching((open) => !open); setQuery(''); requestAnimationFrame(() => searchBox.current?.focus()); }}><Search className="h-4 w-4" /></button>
              <button type="button" className={iconButton} aria-label="Outline" aria-pressed={outline} title="Outline" onClick={() => setOutline((open) => !open)}><ListTree className="h-4 w-4" /></button>
              <button type="button" className={iconButton} aria-label="History" title="History" disabled={!active} onClick={() => setHistory(true)}><History className="h-4 w-4" /></button>
              <div className="relative">
                <button type="button" className={iconButton} aria-label="Export" title="Export" aria-expanded={menu === 'export'} onClick={() => setMenu(menu === 'export' ? null : 'export')}><Download className="h-4 w-4" /></button>
                <Menu open={menu === 'export'} onClose={() => setMenu(null)} align="right">
                  <MenuItem onClick={() => { downloadMarkdown(pageTitle, markdownNow()); setMenu(null); }}><Download className="h-4 w-4" />Download as Markdown</MenuItem>
                  <MenuItem onClick={() => { void navigator.clipboard.writeText(editor?.getText({ blockSeparator: '\n\n' }) ?? '').then(() => toast.success('Copied the page as text.')); setMenu(null); }}><Copy className="h-4 w-4" />Copy as text</MenuItem>
                  <MenuItem onClick={() => { printNotes(pageTitle, goal.name, editor?.getHTML() ?? ''); setMenu(null); }}><Printer className="h-4 w-4" />Print or save as PDF</MenuItem>
                </Menu>
              </div>
              <button type="button" className={iconButton} aria-label={focus ? 'Leave focus mode' : 'Focus mode'} title={focus ? 'Leave focus mode (Esc)' : 'Focus mode'} onClick={() => setFocus((on) => !on)}>{focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
            </div>

            {/* Page tabs. They wrap rather than scroll, so their menus aren't cut off. */}
            <div className="-mb-px flex w-full flex-wrap items-end gap-1">
              {(pages.length ? pages : [{ id: 0, title: 'Notes' } as NotePage]).map((page) => {
                const current = page.id === active?.id || (!active && page.id === 0);
                if (renaming?.id === page.id) {
                  return <input key={page.id} autoFocus aria-label="Page name" value={renaming.title} maxLength={80} onChange={(event) => setRenaming({ ...renaming, title: event.target.value })} onBlur={() => void rename()} onKeyDown={(event) => { if (event.key === 'Enter') void rename(); if (event.key === 'Escape') setRenaming(null); }} className="brutalist-input mb-1 h-[30px] !w-40 !py-1 text-xs" />;
                }
                return (
                  <div key={page.id} className={cn('relative flex shrink-0 items-center border-b-2', current ? 'border-[var(--ref-primary)]' : 'border-transparent')}>
                    <button type="button" onClick={() => page.id && switchTo(page)} onDoubleClick={() => page.id && setRenaming({ id: page.id, title: page.title })} className={cn('h-9 px-2.5 text-sm', current ? 'font-semibold text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]')}>{page.title}</button>
                    {current && page.id > 0 && (
                      <>
                        <button type="button" aria-label={`Options for ${page.title}`} aria-expanded={menu === 'page'} onClick={() => setMenu(menu === 'page' ? null : 'page')} className="mr-1 grid h-6 w-6 place-items-center rounded text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><MoreHorizontal className="h-3.5 w-3.5" /></button>
                        <Menu open={menu === 'page'} onClose={() => setMenu(null)}>
                          <MenuItem onClick={() => { setRenaming({ id: page.id, title: page.title }); setMenu(null); }}>Rename</MenuItem>
                          <MenuItem disabled={pages[0]?.id === page.id} onClick={() => move(-1)}>Move left</MenuItem>
                          <MenuItem disabled={pages.at(-1)?.id === page.id} onClick={() => move(1)}>Move right</MenuItem>
                          <MenuItem danger onClick={() => void remove()}>Delete page</MenuItem>
                        </Menu>
                      </>
                    )}
                  </div>
                );
              })}
              <div className="relative shrink-0">
                <button type="button" aria-label="Add a page" aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')} className="mb-1 grid h-7 w-7 place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><Plus className="h-4 w-4" /></button>
                <Menu open={menu === 'add'} onClose={() => setMenu(null)}>
                  <MenuItem onClick={() => void addFrom('New page')}><Plus className="h-4 w-4" />Blank page</MenuItem>
                  {templates.map((template) => <MenuItem key={template.title} onClick={() => void addFrom(template.title, template.content)}>{template.title}</MenuItem>)}
                </Menu>
              </div>
            </div>
          </div>

          {searching && (
            <div className="border-b border-[var(--color-border)] px-4 py-2.5 sm:px-5">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />
                <input ref={searchBox} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearching(false); setQuery(''); } }} placeholder="Search these notes and your other goals" aria-label="Search notes" className="h-[30px] min-w-0 flex-1 bg-transparent text-sm outline-none" />
                {query.trim().length >= 2 && <span className="shrink-0 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{matchesHere} on this page</span>}
                <button type="button" aria-label="Close search" onClick={() => { setSearching(false); setQuery(''); }} className="grid h-6 w-6 place-items-center rounded text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><X className="h-3.5 w-3.5" /></button>
              </div>
              {query.trim().length >= 2 && (matchesElsewhere.length > 0 || fromOtherGoals.length > 0) && (
                <ul className="mt-2 space-y-1 text-sm">
                  {matchesElsewhere.map(({ page, count }) => (
                    <li key={page.id}><button type="button" onClick={() => switchTo(page)} className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-[var(--ref-surface-container-low)]"><span>{page.title}</span><span className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{count} match{count === 1 ? '' : 'es'}</span></button></li>
                  ))}
                  {fromOtherGoals.slice(0, 5).map((hit) => (
                    <li key={`${hit.goalId}-${hit.pageId}`}>
                      <Link to="/goals/$goalId" params={{ goalId: String(hit.goalId) }} className="block rounded-lg px-2 py-1 hover:bg-[var(--ref-surface-container-low)]">
                        <span className="text-[var(--ref-on-surface)]">{hit.goalIcon ?? '🎯'} {hit.goalName} · {hit.pageTitle}</span>
                        <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{hit.snippet}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={cn('grid gap-4 px-4 py-4 sm:px-5', outline && 'lg:grid-cols-[180px_minmax(0,1fr)]')}>
            {outline && (
              <nav aria-label="Outline" className="text-sm lg:sticky lg:top-20 lg:self-start">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ref-outline)]">Outline</p>
                {headings.length === 0 ? <p className="text-xs text-[var(--ref-on-surface-variant)]">Headings show here.</p> : (
                  <ul className="space-y-0.5">
                    {headings.map((heading) => (
                      <li key={heading.pos}><button type="button" onClick={() => jumpTo(heading)} className={cn('block w-full truncate rounded-md px-2 py-1 text-left hover:bg-[var(--ref-surface-container-low)]', heading.level === 3 ? 'pl-5 text-xs text-[var(--ref-on-surface-variant)]' : 'text-[var(--ref-on-surface)]')}>{heading.text || 'Untitled'}</button></li>
                    ))}
                  </ul>
                )}
              </nav>
            )}
            {pagesQuery.isPending ? <div className="min-h-[160px] animate-pulse rounded-xl bg-[var(--ref-surface-container-low)]" /> : (
              <NotesEditor
                key={editorKey}
                pageKey={`${goalId}:${active?.id ?? 'new'}`}
                initial={active?.content ?? ''}
                starters={starters}
                searchQuery={searching ? query : ''}
                onSave={save}
                onStatus={setStatus}
                onEditor={setEditor}
                onCounts={setCounts}
              />
            )}
          </div>
        </div>
      </section>
      {history && active && <HistoryDialog pageId={active.id} pageTitle={active.title} restoring={restore.isPending} onRestore={(versionId) => void restoreCopy(versionId)} onClose={() => setHistory(false)} />}
    </NotesContext.Provider>
  );
}
