import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { BubbleMenu, EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import {
  Bold, CalendarDays, Eraser, ExternalLink, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, Minus, Quote,
  Receipt, Rows3, Columns3, SquareStack, Strikethrough, Table as TableIcon, Trash2, Ticket, FileText,
} from 'lucide-react';
import { toast } from '../../../components/ui/useToast';
import { cn } from '../../../lib/utils';
import { goalFileUrl, usePreviewLinkMutation, useUploadGoalFileMutation } from '../queries';
import { BlockHandle } from './BlockHandle';
import { useNotesContext, type NoteTarget } from './context';
import { DateChip, Folding, GoalRef, LinkCard, SearchHighlight, SizedImage, searchKey } from './nodes';
import { checklistCount, isoDate, parseDateInput, sumAmounts } from './notes-utils';

const MAX_LENGTH = 100_000;
const SAVE_AFTER_MS = 700;
const MENU_WIDTH = 264;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type Icon = ComponentType<{ className?: string }>;
type MenuAction = { type: 'block'; block: string } | { type: 'ref'; target: NoteTarget } | { type: 'date'; date: Date };
type MenuItem = { key: string; label: string; hint?: string; icon: Icon; action: MenuAction };

const BLOCKS: Array<{ key: string; label: string; hint: string; icon: Icon }> = [
  { key: 'heading', label: 'Heading', hint: 'A section title', icon: Heading2 },
  { key: 'subheading', label: 'Small heading', hint: 'A smaller title', icon: Heading3 },
  { key: 'checklist', label: 'Checklist', hint: 'Things to do, ticked as you go', icon: ListChecks },
  { key: 'bullets', label: 'Bulleted list', hint: 'A simple list', icon: List },
  { key: 'numbers', label: 'Numbered list', hint: 'Steps in order', icon: ListOrdered },
  { key: 'table', label: 'Table', hint: 'Rows and columns to compare', icon: TableIcon },
  { key: 'picture', label: 'Picture', hint: 'From your device; or paste one', icon: ImageIcon },
  { key: 'card', label: 'Link card', hint: 'A shop or booking page as a card', icon: SquareStack },
  { key: 'date', label: 'Date', hint: 'Or type @', icon: CalendarDays },
  { key: 'link', label: 'Link to a part or file', hint: 'Or type [[', icon: Link2 },
  { key: 'quote', label: 'Quote', hint: 'Set a line apart', icon: Quote },
  { key: 'divider', label: 'Divider', hint: 'A line between parts', icon: Minus },
];

/** What the open menu offers for what's been typed after `/`, `[[` or `@`. */
function menuItems(trigger: Trigger, targets: NoteTarget[], now = new Date()): MenuItem[] {
  const query = trigger.query.trim().toLowerCase();
  if (trigger.kind === 'slash') {
    return BLOCKS.filter((block) => `${block.label} ${block.key}`.toLowerCase().includes(query)).map((block) => ({ ...block, action: { type: 'block', block: block.key } }));
  }
  if (trigger.kind === 'ref') {
    return targets
      .filter((target) => target.label.toLowerCase().includes(query))
      .slice(0, 8)
      .map((target) => ({
        key: `${target.kind}-${target.id}`,
        label: target.label,
        hint: [target.kind === 'part' ? 'Part' : target.kind === 'booking' ? 'Booking' : 'File', target.detail].filter(Boolean).join(' · '),
        icon: REF_ICONS[target.kind],
        action: { type: 'ref', target },
      }));
  }
  const typed = parseDateInput(trigger.query, now);
  const options = typed
    ? [{ label: typed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), date: typed }]
    : [
        { label: 'Today', date: now },
        { label: 'Tomorrow', date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) },
        { label: 'Next week', date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7) },
        { label: 'Next month', date: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()) },
      ].filter((option) => !query || option.label.toLowerCase().includes(query));
  return options.map((option) => ({
    key: option.label,
    label: option.label,
    hint: typed ? 'Press Enter' : option.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    icon: CalendarDays,
    action: { type: 'date', date: option.date },
  }));
}
type Trigger = { kind: 'slash' | 'ref' | 'date'; query: string; from: number; to: number; left: number; top: number; index: number };

/** Highlight colours: soft enough to read dark text on, in light and dark themes. */
const HIGHLIGHTS = [
  { label: 'Yellow', color: '#fef08a' },
  { label: 'Green', color: '#bbf7d0' },
  { label: 'Blue', color: '#bfdbfe' },
  { label: 'Pink', color: '#fbcfe8' },
];

const REF_ICONS: Record<NoteTarget['kind'], Icon> = { part: Receipt, booking: Ticket, file: FileText };
const markdownOf = (editor: Editor): string => (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown();
const isUrl = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

/**
 * One page of a goal's notes, written in place. Markdown shortcuts format as you type; `/` offers
 * blocks (headings, lists, a table, a picture, a link card, a date), `[[` links a part, booking or
 * file of the goal, `@` adds a date. Selecting text shows a toolbar (with the total of any amounts
 * in it), a table gets its own, pasted or dropped pictures upload, and a link pasted on an empty
 * line becomes a card. Every change saves by itself.
 */
export function NotesEditor({ pageKey, initial, starters, searchQuery, onSave, onStatus, onEditor, onCounts }: {
  /** Names this page for remembering its folded sections. */
  pageKey: string;
  initial: string;
  /** Ways an empty page can start, like the goal type's notes. */
  starters: Array<{ label: string; markdown: string }>;
  searchQuery: string;
  onSave: (markdown: string) => Promise<void>;
  onStatus: (status: SaveStatus) => void;
  onEditor?: (editor: Editor | null) => void;
  onCounts?: (counts: { done: number; total: number }) => void;
}) {
  const { goalId, targets, formatAmount } = useNotesContext();
  const upload = useUploadGoalFileMutation();
  const preview = usePreviewLinkMutation();
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [empty, setEmpty] = useState(!initial.trim());
  const [linking, setLinking] = useState<string | null>(null);
  const [cardAt, setCardAt] = useState<{ left: number; top: number; url: string } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const triggerRef = useRef<Trigger | null>(null);
  const targetsRef = useRef(targets);
  useEffect(() => { targetsRef.current = targets; }, [targets]);
  const lastSaved = useRef(initial);
  const timer = useRef<number | null>(null);
  const saveRef = useRef(onSave);
  const statusRef = useRef(onStatus);
  const countsRef = useRef(onCounts);
  useEffect(() => { saveRef.current = onSave; statusRef.current = onStatus; countsRef.current = onCounts; }, [onSave, onStatus, onCounts]);

  const updateTrigger = (next: Trigger | null) => {
    triggerRef.current = next;
    setTrigger(next);
  };

  const flush = useCallback(async (editor: Editor) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const markdown = markdownOf(editor).trim();
    if (markdown === lastSaved.current.trim()) return;
    if (markdown.length > MAX_LENGTH) return statusRef.current('error');
    statusRef.current('saving');
    try {
      await saveRef.current(markdown);
      lastSaved.current = markdown;
      statusRef.current('saved');
    } catch {
      statusRef.current('error');
    }
  }, []);

  /** Uploads pictures to the goal and puts them in the page, at `at` or where the cursor is. */
  const addPictures = useCallback(async (files: File[], at?: number) => {
    for (const file of files.filter((item) => item.type.startsWith('image/'))) {
      try {
        const saved = await upload.mutateAsync({ id: goalId, file, fromNotes: true });
        const editor = editorRef.current;
        if (!editor) return;
        const content = { type: 'image', attrs: { src: goalFileUrl(saved.id), alt: file.name.replace(/\.[^.]+$/, '') } };
        if (at !== undefined) editor.chain().focus().insertContentAt(at, content).run();
        else editor.chain().focus().insertContent(content).run();
      } catch (error) {
        toast.error(`${file.name}: ${error instanceof Error ? error.message : 'Could not upload'}`);
      }
    }
  }, [goalId, upload]);

  /** Puts a link card in, then reads the page for its title and picture. */
  const addCard = useCallback(async (url: string) => {
    const editor = editorRef.current;
    if (!editor || !isUrl(url)) return;
    editor.chain().focus().insertContent({ type: 'linkCard', attrs: { href: url.trim(), title: '', image: null } }).run();
    try {
      const read = await preview.mutateAsync(url.trim());
      const current = editorRef.current;
      if (!current) return;
      current.state.doc.descendants((node, pos) => {
        if (node.type.name === 'linkCard' && node.attrs.href === url.trim() && !node.attrs.title) {
          current.view.dispatch(current.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, title: read.title ?? '', image: read.image }));
          return false;
        }
        return true;
      });
    } catch {
      // A page the scraper can't read stays a plain card with its address.
    }
  }, [preview]);

  /** Does what a menu item says, in place of what was typed to open the menu. */
  const pick = useCallback((item: MenuItem) => {
    const state = triggerRef.current;
    const current = editorRef.current;
    if (!state || !current) return;
    current.chain().focus().deleteRange({ from: state.from, to: state.to }).run();
    const chain = () => current.chain().focus();
    const { action } = item;
    if (action.type === 'ref') {
      chain().insertContent([{ type: 'goalRef', attrs: { kind: action.target.kind, id: action.target.id, label: action.target.label } }, { type: 'text', text: ' ' }]).run();
    } else if (action.type === 'date') {
      chain().insertContent([{ type: 'dateChip', attrs: { date: isoDate(action.date) } }, { type: 'text', text: ' ' }]).run();
    } else {
      switch (action.block) {
        case 'heading': chain().setNode('heading', { level: 2 }).run(); break;
        case 'subheading': chain().setNode('heading', { level: 3 }).run(); break;
        case 'checklist': chain().toggleTaskList().run(); break;
        case 'bullets': chain().toggleBulletList().run(); break;
        case 'numbers': chain().toggleOrderedList().run(); break;
        case 'table': chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
        case 'picture': picture.current?.click(); break;
        case 'card': setCardAt({ left: state.left, top: state.top, url: '' }); break;
        case 'date': chain().insertContent('@').run(); break;
        case 'link': chain().insertContent('[[').run(); break;
        case 'quote': chain().toggleBlockquote().run(); break;
        case 'divider': chain().setHorizontalRule().run(); break;
      }
    }
    // Typing `@` or `[[` from the menu opens the next menu by itself.
    if (!(action.type === 'block' && (action.block === 'date' || action.block === 'link'))) updateTrigger(null);
  }, []);

  // Watches the text before the cursor for `/word`, `[[name` or `@date`.
  const watch = (editor: Editor) => {
    const { state, view } = editor;
    const { $from, empty: collapsed } = state.selection;
    if (!collapsed || !$from.parent.isTextblock) return updateTrigger(null);
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    const found = (() => {
      const ref = /\[\[([^\]\n]{0,40})$/.exec(before);
      if (ref) return { kind: 'ref' as const, query: ref[1] ?? '', length: (ref[1] ?? '').length + 2 };
      const slash = /(?:^|\s)\/([a-z ]{0,20})$/i.exec(before);
      if (slash) return { kind: 'slash' as const, query: slash[1] ?? '', length: (slash[1] ?? '').length + 1 };
      const date = /(?:^|\s)@([\w/ -]{0,20})$/.exec(before);
      if (date) return { kind: 'date' as const, query: date[1] ?? '', length: (date[1] ?? '').length + 1 };
      return null;
    })();
    if (!found) return updateTrigger(null);
    const coords = view.coordsAtPos($from.pos);
    const box = frame.current?.getBoundingClientRect();
    const current = triggerRef.current;
    updateTrigger({
      kind: found.kind,
      query: found.query,
      from: $from.pos - found.length,
      to: $from.pos,
      left: box ? Math.max(0, Math.min(coords.left - box.left, box.width - MENU_WIDTH)) : 0,
      top: box ? coords.bottom - box.top + 6 : 0,
      index: current && current.kind === found.kind && current.query === found.query ? current.index : 0,
    });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noreferrer noopener', target: '_blank' } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Write here. Type / for blocks, [[ to link a part or file, @ for a date.') }),
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      SizedImage,
      GoalRef,
      DateChip,
      LinkCard,
      Folding.configure({ storageKey: `fainens.goal-notes.fold:${pageKey}` }),
      SearchHighlight,
      Markdown.configure({ html: true, tightLists: true, linkify: true, transformPastedText: true }),
    ],
    content: initial,
    editorProps: {
      attributes: { class: 'goal-notes-editor', 'aria-label': 'Notes' },
      handleKeyDown: (_view, event) => {
        const state = triggerRef.current;
        if (!state) return false;
        const items = menuItems(state, targetsRef.current);
        if (event.key === 'Escape') {
          updateTrigger(null);
          return true;
        }
        if (!items.length) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          updateTrigger({ ...state, index: (state.index + step + items.length) % items.length });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          pick(items[Math.min(state.index, items.length - 1)]!);
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
        if (files.length) {
          void addPictures(files);
          return true;
        }
        // A link pasted on an empty line becomes a card.
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const { $from } = view.state.selection;
        if (isUrl(text) && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0 && $from.depth === 1) {
          void addCard(text);
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void addPictures(files, at);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      setEmpty(current.isEmpty);
      watch(current);
      const markdown = markdownOf(current);
      countsRef.current?.(checklistCount(markdown));
      statusRef.current('idle');
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(current), SAVE_AFTER_MS);
    },
    onCreate: ({ editor: current }) => countsRef.current?.(checklistCount(markdownOf(current))),
    onSelectionUpdate: ({ editor: current }) => watch(current),
    onBlur: ({ editor: current }) => {
      // A click on a menu lands before it closes.
      window.setTimeout(() => updateTrigger(null), 150);
      void flush(current);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // The search words light up in the page.
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta(searchKey, searchQuery));
  }, [editor, searchQuery]);

  // Unsaved changes are saved when the page is left.
  useEffect(() => () => {
    if (editor && timer.current) void flush(editor);
  }, [editor, flush]);

  if (!editor) return <div className="min-h-[160px]" />;

  const chain = () => editor.chain().focus();
  const items = trigger ? menuItems(trigger, targets) : [];

  const inLink = editor.isActive('link');
  const href = (editor.getAttributes('link').href as string | undefined) ?? '';
  const { from, to } = editor.state.selection;
  const total = from !== to ? sumAmounts(editor.state.doc.textBetween(from, to, ' ')) : 0;
  const bubble = [
    { label: 'Bold', icon: Bold, active: editor.isActive('bold'), run: () => chain().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: editor.isActive('italic'), run: () => chain().toggleItalic().run() },
    { label: 'Strikethrough', icon: Strikethrough, active: editor.isActive('strike'), run: () => chain().toggleStrike().run() },
    { label: 'Heading', icon: Heading2, active: editor.isActive('heading', { level: 2 }), run: () => chain().toggleHeading({ level: 2 }).run() },
    { label: 'Checklist', icon: ListChecks, active: editor.isActive('taskList'), run: () => chain().toggleTaskList().run() },
    { label: 'Link', icon: Link2, active: inLink, run: () => setLinking(href || 'https://') },
  ];
  const tableTools = [
    { label: 'Add a row', icon: Rows3, run: () => chain().addRowAfter().run() },
    { label: 'Add a column', icon: Columns3, run: () => chain().addColumnAfter().run() },
    { label: 'Remove this row', icon: Minus, run: () => chain().deleteRow().run() },
    { label: 'Remove this column', icon: Eraser, run: () => chain().deleteColumn().run() },
    { label: 'Remove the table', icon: Trash2, run: () => chain().deleteTable().run() },
  ];
  const toolButton = (active?: boolean) => cn('grid h-[30px] w-[30px] place-items-center rounded-lg hover:bg-[var(--ref-surface-container-low)]', active ? 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)]');

  return (
    <div ref={frame} className="goal-notes relative pl-6">
      <input ref={picture} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(event) => { if (event.target.files?.length) void addPictures(Array.from(event.target.files)); event.target.value = ''; }} />

      <BubbleMenu editor={editor} pluginKey="goal-notes-text" tippyOptions={{ duration: 120, placement: 'top' }} shouldShow={({ editor: current, from: start, to: end }) => start !== end && !current.isActive('image') && !current.isActive('linkCard') && !current.isActive('goalRef') && !current.isActive('dateChip')}>
        <div className="flex items-center gap-0.5 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1 shadow-lg">
          {linking !== null ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                const url = linking.trim();
                const link = editor.chain().focus().extendMarkRange('link');
                (url && /^https?:\/\//i.test(url) ? link.setLink({ href: url }) : link.unsetLink()).run();
                setLinking(null);
              }}
            >
              <input autoFocus aria-label="Link address" value={linking} onChange={(event) => setLinking(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setLinking(null); }} className="brutalist-input h-[30px] w-56 text-xs" />
              <button type="submit" className="h-[30px] rounded-lg px-2 text-xs font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-surface-container-low)]">Save</button>
            </form>
          ) : (
            <>
              {bubble.map(({ label, icon: ToolIcon, active, run }) => (
                <button key={label} type="button" title={label} aria-label={label} aria-pressed={active} onClick={run} className={toolButton(active)}><ToolIcon className="h-4 w-4" /></button>
              ))}
              {inLink && href && <a href={href} target="_blank" rel="noreferrer noopener" title="Open link" aria-label="Open link" className={toolButton()}><ExternalLink className="h-4 w-4" /></a>}
              <span className="mx-1 h-5 w-px bg-[var(--color-border)]" aria-hidden />
              {HIGHLIGHTS.map((highlight) => (
                <button key={highlight.color} type="button" title={`${highlight.label} highlight`} aria-label={`${highlight.label} highlight`} aria-pressed={editor.isActive('highlight', { color: highlight.color })} onClick={() => chain().toggleHighlight({ color: highlight.color }).run()} className="grid h-[30px] w-[22px] place-items-center rounded-lg hover:bg-[var(--ref-surface-container-low)]">
                  <span className={cn('h-3.5 w-3.5 rounded-full ring-1 ring-black/10', editor.isActive('highlight', { color: highlight.color }) && 'ring-2 ring-[var(--ref-primary)]')} style={{ background: highlight.color }} />
                </button>
              ))}
              {editor.isActive('highlight') && <button type="button" title="Remove highlight" aria-label="Remove highlight" onClick={() => chain().unsetHighlight().run()} className={toolButton()}><Eraser className="h-4 w-4" /></button>}
              {total > 0 && <span className="ml-1 whitespace-nowrap rounded-lg bg-[var(--ref-surface-container-low)] px-2 py-1 text-xs font-semibold tabular-nums text-[var(--ref-on-surface)]" title="The amounts in what you selected, added up">Total {formatAmount(total)}</span>}
            </>
          )}
        </div>
      </BubbleMenu>

      <BubbleMenu editor={editor} pluginKey="goal-notes-table" tippyOptions={{ duration: 120, placement: 'top-start' }} shouldShow={({ editor: current, from: start, to: end }) => start === end && current.isActive('table')}>
        <div className="flex items-center gap-0.5 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1 shadow-lg">
          {tableTools.map(({ label, icon: ToolIcon, run }) => (
            <button key={label} type="button" title={label} aria-label={label} onClick={run} className={toolButton()}><ToolIcon className="h-4 w-4" /></button>
          ))}
        </div>
      </BubbleMenu>

      <BlockHandle editor={editor} frame={frame} />
      <EditorContent editor={editor} />

      {empty && !editor.isFocused && (
        <div className="mt-2 flex flex-wrap gap-2">
          {starters.map((starter) => (
            <button key={starter.label} type="button" onClick={() => chain().setContent(starter.markdown).run()} className="h-[30px] rounded-lg border border-[var(--color-border)] px-2.5 text-xs font-semibold text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]">{starter.label}</button>
          ))}
          <button type="button" onClick={() => chain().toggleTaskList().run()} className="h-[30px] rounded-lg border border-[var(--color-border)] px-2.5 text-xs font-semibold text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]">Add a checklist</button>
        </div>
      )}

      {trigger && (
        <ul role="listbox" aria-label={trigger.kind === 'slash' ? 'Add a block' : trigger.kind === 'ref' ? 'Link a part, booking or file' : 'Add a date'} className="absolute z-30 max-h-72 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-1 shadow-lg" style={{ left: trigger.left, top: trigger.top, width: MENU_WIDTH }}>
          {items.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--ref-on-surface-variant)]">{trigger.kind === 'ref' ? (targets.length ? 'Nothing by that name' : 'Add parts or files to the goal to link them') : trigger.kind === 'date' ? 'Type a date, like 14 mar or tomorrow' : 'No block by that name'}</li>
          ) : items.map((item, index) => {
            const ItemIcon = item.icon;
            return (
              <li key={item.key} role="option" aria-selected={index === trigger.index}>
                <button type="button" onMouseDown={(event) => { event.preventDefault(); pick(item); }} onMouseEnter={() => updateTrigger({ ...trigger, index })} className={cn('flex w-full items-center gap-3 px-3 py-1.5 text-left', index === trigger.index && 'bg-[var(--ref-surface-container-low)]')}>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] text-[var(--ref-on-surface-variant)]"><ItemIcon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[var(--ref-on-surface)]">{item.label}</span>
                    {item.hint && <span className="block truncate text-[11px] text-[var(--ref-on-surface-variant)]">{item.hint}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {cardAt && (
        <form
          className="absolute z-30 flex gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1.5 shadow-lg"
          style={{ left: cardAt.left, top: cardAt.top, width: MENU_WIDTH + 40 }}
          onSubmit={(event) => { event.preventDefault(); const url = cardAt.url; setCardAt(null); void addCard(url); }}
        >
          <input autoFocus type="url" aria-label="Link for the card" placeholder="https://…" value={cardAt.url} onChange={(event) => setCardAt({ ...cardAt, url: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') { setCardAt(null); editor.commands.focus(); } }} className="brutalist-input h-[30px] min-w-0 flex-1 text-xs" />
          <button type="submit" disabled={!isUrl(cardAt.url)} className="h-[30px] rounded-lg px-2 text-xs font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40">Add</button>
        </form>
      )}
    </div>
  );
}
